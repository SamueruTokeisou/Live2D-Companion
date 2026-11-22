/**
 * 轮廓掩码读回 —— 两个渲染内核（pixi8 / pixi7）共用的实现。
 *
 * 用途：判断鼠标是否落在角色身上（透明处穿透、区域命中）。
 *
 * 性能要点（踩过的坑都在这儿）：
 *   1. **不重画**。早期版本在指针移动时自己再画一整帧，实测 10.8ms/次，而且是在
 *      事件回调里插一次计划外的渲染 —— 掉帧时合成器会短暂显示上一帧（虚影/闪烁）。
 *      现在只在渲染钩子（afterRender）里读「刚画好的那一帧」。
 *   2. **只读包围盒**。整张绘制缓冲区 readPixels 在 DPR 2 的 800×1000 窗口下是
 *      ≈12.8MB/次，鼠标一滚、每 700ms 就再来一遍，缩放/拖动卡顿大半来自这里。
 *      现在记住上一帧非空区域的包围盒（按块对齐、外扩两圈），只读那一块；
 *      输出的网格仍是整张画布的，包围盒外为空，坐标映射完全不变。
 *   3. **自愈**。包围盒贴到读回区域边缘、或这一帧全空（切模型/还没画出来）时，
 *      下一帧自动退回整张，不会把角色「裁掉一半」之后一直错下去。
 */

/** 读回区域在内容包围盒外再留几格（每格 = 降采样倍数个设备像素） */
const MASK_PAD_BLOCKS = 2

export function createMaskReader(app, { padBlocks = MASK_PAD_BLOCKS } = {}) {
  // 下一帧要读回的区域（设备像素，readPixels 的左下原点）；ok=false 时读整张
  const area = { ok: false, x: 0, y: 0, w: 0, h: 0, W: 0, H: 0 }
  // 自适应外扩：角色（尾巴/头发）摆动幅度变化时自己长大，安静下来再缩回去
  let padB = padBlocks
  let goodStreak = 0
  let edgeStreak = 0
  const stats = { captures: 0, full: 0, partial: 0, edge: 0, empty: 0 }

  /**
   * 降采样：每格取块内 5 个采样点（中心 + 四角内缩一格）的 alpha 最大值。
   * 逐像素扫全帧是 395k 次内层循环，采样点法降到 123k 次；边缘本来就有 3×3 膨胀兜着。
   * readPixels 原点在左下，输出翻成屏幕坐标（左上原点），和区域坐标一致。
   */
  const downsample = (read, s) => {
    const { buf, x, y, w, h, W, H } = read
    const fw = Math.max(1, Math.ceil(W / s))
    const fh = Math.max(1, Math.ceil(H / s))
    const data = new Uint8Array(fw * fh)
    const off = Math.floor(s / 2)
    const bx0 = Math.floor(x / s)
    const by0 = Math.floor(y / s)
    const nbx = Math.ceil(w / s)
    const nby = Math.ceil(h / s)
    let minBx = Infinity, maxBx = -1, minBy = Infinity, maxBy = -1
    let touchEdge = false
    // 只有「读回区域的内侧边界」贴到内容才算越界。
    // 画布本身的边不算 —— 角色在窗口里本来就被裁掉一截（脚/裙摆贴着下边缘），
    // 那是常态；把它当成「越界」就会每帧都退回整张读回，优化等于没做。
    const innerL = bx0 > 0
    const innerB = by0 > 0
    const innerR = bx0 + nbx < fw
    const innerT = by0 + nby < fh
    for (let by = 0; by < nby; by++) {
      const gby = by0 + by
      if (gby >= fh) break
      const rowBase = gby * s - y
      for (let bx = 0; bx < nbx; bx++) {
        const gbx = bx0 + bx
        if (gbx >= fw) break
        const colBase = gbx * s - x
        let best = 0
        for (let k = 0; k < 5; k++) {
          const sx = Math.min(w - 1, Math.max(0, colBase + (k === 0 ? off : (k <= 2 ? 1 : s - 2))))
          const sy = Math.min(h - 1, Math.max(0, rowBase + (k === 0 ? off : (k === 1 || k === 3 ? 1 : s - 2))))
          const a = buf[(sy * w + sx) * 4 + 3]
          if (a > best) best = a
          if (best > 200) break
        }
        if (best > 8) {
          data[(fh - 1 - gby) * fw + gbx] = best
          if (gbx < minBx) minBx = gbx
          if (gbx > maxBx) maxBx = gbx
          if (gby < minBy) minBy = gby
          if (gby > maxBy) maxBy = gby
          // 贴到读回区域的内侧边上：角色已经挪出缓存框，下一帧加大外扩
          if ((innerL && gbx === bx0) || (innerB && gby === by0) ||
              (innerR && gbx === bx0 + nbx - 1) || (innerT && gby === by0 + nby - 1)) touchEdge = true
        }
      }
    }
    let hits = 0
    for (let i = 0; i < data.length; i++) if (data[i] > 8) hits++
    stats.captures++
    if (x === 0 && y === 0 && w === W && h === H) stats.full++
    else stats.partial++
    const maxPad = Math.max(padBlocks, Math.ceil(Math.min(fw, fh) / 4))
    if (hits > 0 && !touchEdge) {
      // 稳定：连续 30 次没贴边就把外扩缩回去，空闲时读回面积保持最小
      if (++goodStreak >= 30) { goodStreak = 0; padB = Math.max(padBlocks, padB >> 1) }
      edgeStreak = 0
      area.x = Math.max(0, (minBx - padB) * s)
      area.y = Math.max(0, (minBy - padB) * s)
      area.w = Math.max(1, Math.min(W, (maxBx + 1 + padB) * s) - area.x)
      area.h = Math.max(1, Math.min(H, (maxBy + 1 + padB) * s) - area.y)
      area.ok = true
    } else if (touchEdge) {
      // 角色挪出了缓存框：先加大外扩；连贴三次就老实读整张，并把外扩归零重新长
      stats.edge++
      goodStreak = 0
      if (padB >= maxPad || ++edgeStreak >= 3) {
        area.ok = false
        padB = padBlocks
        edgeStreak = 0
      } else {
        padB = Math.min(maxPad, padB * 2)
        area.x = Math.max(0, (minBx - padB) * s)
        area.y = Math.max(0, (minBy - padB) * s)
        area.w = Math.max(1, Math.min(W, (maxBx + 1 + padB) * s) - area.x)
        area.h = Math.max(1, Math.min(H, (maxBy + 1 + padB) * s) - area.y)
        area.ok = true
      }
    } else {
      // 空帧（切模型/还没画出来）：下一帧读整张
      stats.empty++
      area.ok = false
    }
    area.W = W
    area.H = H
    // read 只用于诊断：这一帧到底读回了多大一块（全帧 vs 包围盒）
    return { w: fw, h: fh, scale: s, coverage: hits / data.length, data, read: { x, y, w, h, fullW: W, fullH: H } }
  }

  /** 读回绘制缓冲区（不重画，必须紧跟在同一任务里刚渲染完的位置）；默认只读包围盒 */
  const readFrame = () => {
    const gl = app.renderer.gl
    const W = app.renderer.width
    const H = app.renderer.height
    let x = 0, y = 0, w = W, h = H
    if (area.ok && area.W === W && area.H === H && area.w > 0) {
      x = area.x; y = area.y; w = area.w; h = area.h
    }
    const buf = new Uint8Array(w * h * 4)
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    return { buf, x, y, w, h, W, H }
  }

  /** 从「已经画好的那一帧」取掩码 —— 不重画，只读包围盒 */
  const captureMask = (scale = 4, onPhase = null) => {
    const phase = onPhase || (() => {})
    let t = performance.now()
    try {
      const read = readFrame()
      const n = performance.now(); phase('read', n - t); t = n
      const out = downsample(read, Math.max(1, Math.round(scale)))
      phase('down', performance.now() - t)
      return out
    } catch (e) {
      console.warn('[captureMask]', (e && e.message) || e)
      return null
    }
  }

  /**
   * 强制同步版：需要当场拿到结果时用（首次交互、模型/尺寸刚变这类低频时机）。
   * 只在这里读整张 —— 它要的是「绝对正确」，不能带着上一帧的包围盒猜。
   */
  const alphaMask = (scale = 4, onPhase = null) => {
    const phase = onPhase || (() => {})
    let t = performance.now()
    try {
      app.renderer.render(app.stage)
      const n = performance.now(); phase('render', n - t); t = n
      area.ok = false
      const read = readFrame()
      const n2 = performance.now(); phase('read', n2 - t); t = n2
      const out = downsample(read, Math.max(1, Math.round(scale)))
      phase('down', performance.now() - t)
      return out
    } catch (e) {
      console.warn('[alphaMask]', (e && e.message) || e)
      return null
    }
  }

  /** 让下一次 captureMask 读整张（切模型 / 改窗口尺寸后调用） */
  const invalidate = () => { area.ok = false }

  return { captureMask, alphaMask, invalidate, stats: () => ({ ...stats }) }
}
