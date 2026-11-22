#!/usr/bin/env node
/** 帧率对照：静置 vs 拖动中，rAF 间隔分布（判断卡顿是渲染侧还是窗口侧） */
const port = 9222
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const send = (method, params) => new Promise((resolve, reject) => {
  const my = ++id
  const on = (e) => { const m = JSON.parse(e.data); if (m.id !== my) return; ws.removeEventListener('message', on); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) }
  ws.addEventListener('message', on)
  ws.send(JSON.stringify({ id: my, method, params }))
})
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

const measure = `(async () => {
  const t = []
  await new Promise((resolve) => {
    const t0 = performance.now()
    const step = () => { t.push(performance.now()); if (performance.now() - t0 < 1500) requestAnimationFrame(step); else resolve() }
    requestAnimationFrame(step)
  })
  const d = []
  for (let i = 1; i < t.length; i += 1) d.push(t[i] - t[i - 1])
  d.sort((a, b) => a - b)
  return { frames: t.length, med: +d[Math.floor(d.length / 2)].toFixed(1), p90: +d[Math.floor(d.length * 0.9)].toFixed(1), max: +d[d.length - 1].toFixed(1) }
})()`

// 透明窗口被遮挡时 Chromium 会把 rAF 节流到 ~30fps：测之前先置顶并聚焦
await ev(`shell.set({ alwaysOnTop: true })`)
await ev(`window.focus()`)
await new Promise((r) => setTimeout(r, 800))
const idle = await ev(measure)
console.log('静置  ', JSON.stringify(idle))
const tick = await ev(`(() => { const s = __probe.dragState(); return s })()`)
// 拖动中：先用 shell.dragBegin 制造拖动状态（不需要真的按鼠标），再测帧
await ev(`shell.dragBegin()`)
const dragging = await ev(measure)
await ev(`shell.dragEnd()`)
console.log('拖动中', JSON.stringify(dragging))
ws.close()
