#!/usr/bin/env node
/** 重载渲染层 → 在指定点按下 → 报告拖动状态，用于定位 canStart 被谁挡住 */
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Page.reload', {})
await sleep(2500)
console.log('reloaded, url', page.url)

const pick = await ev(`(() => {
  for (let y = 40; y < innerHeight - 40; y += 8) {
    for (let x = 20; x < innerWidth - 20; x += 8) {
      if (__probe.hitAt(x, y) === null && __probe.bodyAt(x, y)) return { x, y }
    }
  }
  return null
})()`)
console.log('pick', JSON.stringify(pick))
if (!pick) { ws.close(); process.exit(1) }
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pick.x, y: pick.y, button: 'none', buttons: 0 })
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pick.x, y: pick.y, button: 'left', buttons: 1, clickCount: 1 })
await sleep(150)
console.log('dragState', JSON.stringify(await ev(`__probe.dragState()`)))
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pick.x, y: pick.y, button: 'left', buttons: 0, clickCount: 1 })
await sleep(120)
console.log('after release', JSON.stringify(await ev(`__probe.dragState()`)))
ws.close()
