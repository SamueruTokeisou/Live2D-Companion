/**
 * 时间序列缓存：把「刚刚发生了什么」按环形缓冲记下来。
 *
 * 为什么需要它：
 *   1. **活感**：待机选动作时避开最近几分钟做过的，否则同一套动作反复出现，像循环 GIF；
 *   2. **上下文**：agent 要接话/接动作，得知道「我刚做过什么、用户刚摸了哪」；
 *   3. **排查**：一条时间线比翻日志直观。
 *
 * 只记**事件**（动作 / 互动 / 说话 / 表情），不记每帧参数 —— 每帧数据没有语义，
 * 而且会把内存撑爆。存的是 { seq, at, kind, ... }，默认 200 条，满了丢最旧的。
 */

export function createHistory({ limit = 200 } = {}) {
  const buf = []
  let seq = 0

  function push(ev = {}) {
    const rec = { seq: ++seq, at: Date.now(), ...ev }
    buf.push(rec)
    if (buf.length > limit) buf.splice(0, buf.length - limit)
    return rec
  }

  const all = (n = 30) => buf.slice(Math.max(0, buf.length - n))
  const since = (s = 0) => buf.filter((e) => e.seq > Number(s || 0))
  const ofKind = (kind, n = 10) => buf.filter((e) => e.kind === kind).slice(-n)

  /** 最近 n 条动作名（给待机「防重复」用） */
  const recentActs = (n = 4) => ofKind('act', n).map((e) => e.name).filter(Boolean)

  /** 名字是不是刚做过（within = 最近 n 条动作） */
  const avoid = (name, n = 4) => recentActs(n).includes(name)

  /**
   * 给 agent / 状态快照的摘要：只保留最近几条，带「几秒前」。
   * 文本截断，避免把长台词整段塞进上下文。
   */
  function summary(n = 6) {
    const now = Date.now()
    const ago = (at) => Math.max(0, Math.round((now - at) / 1000))
    return {
      seq,
      total: buf.length,
      acts: ofKind('act', n).map((e) => ({ name: e.name, source: e.source || 'idle', ago: ago(e.at) })),
      touches: ofKind('touch', n).map((e) => ({ region: e.region, gesture: e.gesture, ago: ago(e.at) })),
      says: ofKind('say', 3).map((e) => ({ text: String(e.text || '').slice(0, 40), source: e.source || 'agent', ago: ago(e.at) })),
      exprs: ofKind('expr', 4).map((e) => ({ name: e.name, on: e.on !== false, ago: ago(e.at) })),
    }
  }

  return { push, all, since, ofKind, recentActs, avoid, summary, clear() { buf.length = 0 }, size: () => buf.length }
}
