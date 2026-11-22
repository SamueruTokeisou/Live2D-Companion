/**
 * 网格锚定帧循环：按显示刷新周期的整数倍出帧。
 *
 * 两个引擎（pixi8/default 与 pixi7/cubism4mul）共用这一份 —— 出帧节奏跟渲染分支无关。
 * 为什么不用 ticker.maxFPS：那是「在 rAF 回调里跳过」，跳哪一帧由系统决定。
 * 实测（docs/PERF-RESEARCH.md §8.3）在 240Hz 屏上会得到 3.4 / 7.7 拍交替，比不限帧还抖。
 *
 * 做法：先量出显示刷新周期 P（安静状态下的 rAF 间隔中位数），再固定「每 beats 个周期出一次帧」，
 * 并用「锚点 + 整数拍」计算目标时刻（不用累加 step，避免浮点误差攒成相位漂移）。
 * 关键还有 leadMs = 一拍：单帧耗时接近槽长时，等「正好到点」才动手会赶不上提交，
 * 浏览器会把 BeginFrame 推后（实测 60fps 档只剩 51fps、约 17% 掉帧）；提前一拍开工就稳了。
 */
export function createFrameLoop(app) {
  // ---------- 帧节奏：网格锚定固定步进 ----------
  /**
   * 为什么不用 ticker.maxFPS：那是「在 rAF 回调里跳过」，跳哪一帧由系统决定。
   * 实测（docs/PERF-RESEARCH.md §8.3）在 240Hz 屏上会得到 3.4 / 7.7 拍交替，比不限帧还抖。
   *
   * 这里的做法：先量出显示刷新周期 P（安静状态下的 rAF 间隔中位数），
   * 再固定「每 beats 个刷新周期出一次帧」，用 `next += step` 把相位钉在网格上。
   * 240Hz → P=4.167ms，60fps 时 beats=4，step=16.667ms，正好等于屏幕 4 个刷新。
   */
  const frame = {
    alive: false,
    paused: false,
    /** 窗口不可见时彻底停 rAF（见 halt/wake）；暂停态只是每帧早退，仍在被唤醒 */
    halted: false,
    fps: 60,
    periodMs: 1000 / 60,
    beats: 1,
    step: 1000 / 60,
    anchor: 0,
    k: 0,
    leadMs: 0,
    rafId: 0,
    measured: false,
    hooks: new Set(),
    ticks: 0,
    cost: 0,
    recent: [],
    rafTs: [],
  }

  /**
   * 量显示刷新周期。两个坑：
   *   1. 刚启动时页面还在解码贴图，rAF 会被挤得忽快忽慢 —— 先停 ticker 再等它安静下来；
   *   2. rAF 时间戳有量化噪声，均值会被离群值带跑 —— 取中位数。
   * 量出来再吸附到常见刷新率上（240/180/144/133/120/100/90/72/60），
   * 否则 4.2 和 4.1667 之间的误差会攒成相位漂移。吸不上就当 60Hz（16.667ms，在 240Hz 上正好 4 拍）。
   */
  const CANON_PERIODS = [1000 / 240, 1000 / 180, 1000 / 144, 1000 / 133.333, 1000 / 120, 1000 / 100, 1000 / 90, 1000 / 72, 1000 / 60]
  const snapPeriod = (p) => {
    if (!(p >= 3 && p <= 17.5)) return 1000 / 60
    let best = p
    let bestErr = Infinity
    for (const c of CANON_PERIODS) {
      const err = Math.abs(p - c) / c
      if (err < bestErr) { bestErr = err; best = c }
    }
    return bestErr <= 0.08 ? best : 1000 / 60
  }

  const measureRefreshPeriod = (samples = 41) => new Promise((resolve) => {
    const t = []
    const step = (ts) => {
      t.push(ts)
      if (t.length < samples) { requestAnimationFrame(step); return }
      const d = []
      for (let i = 1; i < t.length; i += 1) d.push(t[i] - t[i - 1])
      d.sort((a, b) => a - b)
      resolve(snapPeriod(d[Math.floor(d.length / 2)]))
    }
    requestAnimationFrame(step)
  })

  const computeStep = () => {
    // 目标帧率换算成「至少几个刷新周期」：只许更慢、不许更快（-0.02 抵掉浮点误差）
    frame.beats = Math.max(1, Math.ceil((1000 / frame.fps) / frame.periodMs - 0.02))
    frame.step = frame.beats * frame.periodMs
    // 提前一拍开工：单帧耗时接近槽长时，等到「正好到点」才动手会赶不上提交
    frame.leadMs = frame.periodMs
  }

  const frameTick = (ts) => {
    // halted：rAF 已经被 cancel，但可能还有一次已排队的回调在飞 —— 别再把它续上
    if (!frame.alive || frame.halted) { frame.rafId = 0; return }
    frame.rafId = requestAnimationFrame(frameTick)
    // 诊断：记下**每个** rAF 回调的时间戳（和实际出帧的时间戳对比，
    // 就能分清「浏览器少给了回调」还是「我们自己判早了/判晚了」）
    frame.rafTs.push(+ts.toFixed(1))
    if (frame.rafTs.length > 24) frame.rafTs.shift()
    if (frame.paused) { frame.anchor = 0; frame.k = 0; return }
    if (!frame.anchor) { frame.anchor = ts; frame.k = 0; return }
    // 目标时刻永远按「锚点 + 整数拍」算，而不是累加 step：
    // 累加会把每次的浮点误差攒起来，几十秒后相位就偏掉一整拍（表现为忽然多停一帧）。
    // 提前一拍开始干活（leadMs = 一个刷新周期）：
    // 单帧耗时接近槽长时，等「正好到点」才开始，提交往往赶不上这一拍 ——
    // 浏览器会把 BeginFrame 推后，表现就是偶尔掉成 2 倍间隔。提前一拍等于把提交期往前挪 4.17ms。
    const target = frame.anchor + (frame.k + 1) * frame.step - frame.leadMs
    if (ts + 0.5 < target) return
    // 掉拍（长卡顿/被拖慢）就跳到当前该在的那一拍，不追帧
    frame.k = Math.max(frame.k + 1, Math.floor((ts - frame.anchor) / frame.step) + 1)
    frame.ticks += 1
    for (const fn of frame.hooks) {
      try { fn(ts) } catch (e) { console.error('[stage] frame hook 失败', e) }
    }
    // 交给 ticker 走原本的优先级顺序：模型更新 → 渲染 → afterRender 钩子（掩码读回挂这里）
    const t0 = performance.now()
    app.ticker.update(ts)
    const cost = performance.now() - t0
    frame.cost = frame.cost ? frame.cost * 0.9 + cost * 0.1 : cost
    frame.recent.push(+ts.toFixed(1))
    if (frame.recent.length > 12) frame.recent.shift()
  }

  const frameLoop = {
    /** 接管出帧：先停掉 ticker 自己的 rAF，量一次刷新周期，然后按网格出帧 */
    async start({ fps = 60 } = {}) {
      if (frame.alive) { frameLoop.setFps(fps); return frameLoop.info() }
      app.ticker.stop()
      if (!frame.measured) {
        // 先静一下：模型刚加载完时主线程还在忙，这时量的 rAF 间隔不可信
        await new Promise((r) => setTimeout(r, 200))
        frame.periodMs = await measureRefreshPeriod()
        frame.measured = true
      }
      frame.fps = Math.max(1, Math.min(240, Math.round(fps)))
      computeStep()
      frame.alive = true
      frame.paused = false
      frame.halted = false
      frame.anchor = 0
      frame.k = 0
      frame.rafId = requestAnimationFrame(frameTick)
      return frameLoop.info()
    },
    stop() {
      if (!frame.alive) return
      frame.alive = false
      cancelAnimationFrame(frame.rafId)
      frame.rafId = 0
      app.ticker.start()
    },
    setFps(fps) {
      frame.fps = Math.max(1, Math.min(240, Math.round(fps)))
      computeStep()
      frame.anchor = 0
      frame.k = 0
    },
    pause() { frame.paused = true },
    resume() { frame.paused = false; frame.anchor = 0; frame.k = 0 },
    /**
     * 彻底停帧：窗口被隐藏/最小化时用。
     * 不能只靠 pause() —— 那只是每帧早退，rAF 仍按显示刷新被唤醒（240Hz 屏 = 每秒 240 次空转），
     * 而舞台窗口是 backgroundThrottling:false，隐藏后浏览器不会替我们降频。
     * 这里直接 cancel 掉 rAF，一秒都不再被叫醒。
     */
    halt() {
      if (frame.halted) return
      frame.halted = true
      if (frame.rafId) cancelAnimationFrame(frame.rafId)
      frame.rafId = 0
      // 锚点作废：重新可见时按新的时间戳重新起网格，避免拿几小时前的锚点去算拍
      frame.anchor = 0
      frame.k = 0
    },
    wake() {
      if (!frame.halted || !frame.alive) { frame.halted = false; return }
      frame.halted = false
      frame.anchor = 0
      frame.k = 0
      frame.rafId = requestAnimationFrame(frameTick)
    },
    /** 每帧「出帧之前」调用：resize 这类必须与渲染同拍的活儿挂这里 */
    onFrame(fn) { frame.hooks.add(fn); return () => frame.hooks.delete(fn) },
    info: () => ({
      alive: frame.alive, paused: frame.paused, halted: frame.halted, fps: frame.fps,
      periodMs: +frame.periodMs.toFixed(3), beats: frame.beats, stepMs: +frame.step.toFixed(3), ticks: frame.ticks, leadMs: +frame.leadMs.toFixed(3),
      costMs: +frame.cost.toFixed(2), recent: frame.recent.slice(), rafTs: frame.rafTs.slice(),
    }),
  }

  return frameLoop
}
