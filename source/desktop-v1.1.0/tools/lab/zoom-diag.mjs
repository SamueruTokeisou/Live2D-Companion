#!/usr/bin/env node
/** 一次性诊断：中键滚轮事件到底有没有进到 handler */
const port = 9222
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const t = list.find((x) => x.type === 'page' && /app\//.test(x.url))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const ev = (expression) => new Promise((resolve, reject) => {
  const my = ++id
  const on = (e) => {
    const m = JSON.parse(e.data)
    if (m.id !== my) return
    ws.removeEventListener('message', on)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result.result?.value)
  }
  ws.addEventListener('message', on)
  ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
})

console.log('hit', await ev(`__probe.hitAt(317,175)`))
console.log('box', JSON.stringify(await ev(`__probe.regionBox('头')`)))
console.log('zoom', await ev(`__probe.zoom()`))
console.log('shellZoomFn', await ev(`typeof window.__stageRpc`))
// 直接派发并看 e.buttons
console.log('dispatch', await ev(`(() => {
  let seen = null
  const h = (e) => { seen = { buttons: e.buttons, deltaY: e.deltaY, x: e.clientX } }
  window.addEventListener('wheel', h, { passive: true })
  const ok = window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, buttons: 4, clientX: 317, clientY: 175, screenX: 501, screenY: 310, bubbles: true, cancelable: true }))
  window.removeEventListener('wheel', h)
  return { ok, seen }
})()`))
await new Promise((r) => setTimeout(r, 400))
console.log('zoomAfter', await ev(`__probe.zoom()`))
console.log('settingsZoom', await ev(`(__probe && window.__stageRpc) ? 'rpc' : 'no'`))
ws.close()
