/**
 * 故障记录（渲染层）。
 *
 * 目标很具体：用户说「坏了」的时候，他不用描述，导出一份报告丢给 AI 就能定位。
 * 所以这里记的不是普通日志，而是**故障事件**：全局报错、未处理的 rejection、
 * console.error/warn（扩展加载失败、provider 出错都走这里）、上下文丢失、长帧。
 *
 * 设计取舍：
 *   · 环形缓冲，最多 200 条 —— 桌面宠物一开一整天，无上限会吃内存；
 *   · 每条都带时间戳和上下文，但**不记用户输入的内容**（台词/聊天不进这里）；
 *   · 同步回调给主进程（send），主进程那份才是导出用的权威副本，
 *     因为渲染进程崩溃后它自己的内存就没了 —— 崩溃前的记录必须早点交出去。
 */

const MAX = 200

const fmtArg = (v) => {
  if (typeof v === 'string') return v
  if (v instanceof Error) return `${v.name}: ${v.message}`
  try { return JSON.stringify(v) } catch { return String(v) }
}
const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '…' : String(s || ''))

/**
 * @param {{ send?: (kind: string, detail: object) => void, info?: object, limit?: number }} opts
 * @returns {{ push: Function, list: Function, snapshot: Function, destroy: Function }}
 */
export function createFaultLog({ send, info = {}, limit = MAX } = {}) {
  const rows = []
  const created = performance.now()
  let muted = false   // 自己记故障时别再触发 console 钩子（会无限套娃）

  const push = (kind, detail = {}) => {
    const rec = { t: new Date().toISOString(), kind: String(kind), ...detail }
    rows.push(rec)
    if (rows.length > limit) rows.shift()
    muted = true
    try { send?.(rec.kind, detail) } catch {}
    muted = false
    return rec
  }

  const onError = (e) => push('renderer:error', {
    message: clip(e?.message, 300),
    src: clip(e?.filename, 200),
    line: e?.lineno || 0,
    col: e?.colno || 0,
    stack: clip(e?.error?.stack, 1500),
  })
  const onRejection = (e) => push('renderer:unhandled-rejection', {
    message: clip(e?.reason?.message || e?.reason, 300),
    stack: clip(e?.reason?.stack, 1500),
  })
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...a) => {
    if (!muted) push('console:error', { text: clip(a.map(fmtArg).join(' '), 800) })
    origError(...a)
  }
  console.warn = (...a) => {
    if (!muted) push('console:warn', { text: clip(a.map(fmtArg).join(' '), 800) })
    origWarn(...a)
  }

  // 长帧：>120ms 才算（窗口拖动的正常抖动是 20~40ms，别把它记成故障）
  let lastFrame = 0
  let lastStallAt = 0
  const frameGap = (ts) => {
    if (document.hidden || performance.now() - created < 8000) { lastFrame = 0; return }
    if (lastFrame && ts - lastFrame > 120) {
      const now = performance.now()
      if (now - lastStallAt > 5000) {   // 同一波卡顿只记一条
        lastStallAt = now
        push('frame:stall', { gapMs: +(ts - lastFrame).toFixed(1) })
      }
    }
    lastFrame = ts
  }

  return {
    push,
    frameGap,
    /** 窗口重新可见时调：清掉时间基准，别把「隐藏时长」记成一次卡顿 */
    resetFrameClock() { lastFrame = 0; lastStallAt = 0 },
    list: () => rows.slice(),
    /** 导出时给主进程用：最近 40 条 + 环境信息（正常导出走主进程，这里只是兜底） */
    snapshot: () => ({ ...info, incidents: rows.slice(-40) }),
    destroy() {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      console.error = origError
      console.warn = origWarn
    },
  }
}
