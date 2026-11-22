#!/usr/bin/env node
/**
 * 气泡被顶掉验证：先摸一下「胯」触发带 4.2s 自动隐藏的台词，
 * 中途立刻换一句新话；旧的定时器到点后不应该把新话收掉。
 */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const box = await ev(`__probe.regionBox('胯')`)
if (!box) { console.log('FAIL 没有胯热区'); ws.close(); process.exit(1) }
const x = Math.round(box.left + box.width / 2)
const y = Math.round(box.top + box.height / 2)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
await sleep(120)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
await sleep(400)
const first = await ev(`__probe.bubbleState ? __probe.bubbleState() : null`)
console.log('触发台词', JSON.stringify(first))

await ev(`__probe.bubble('这是新的一句，别收我')`)
await sleep(4600)
const after = await ev(`__probe.bubble ? __probe.bubble() : (window.__probe.bubbleState ? __probe.bubbleState() : null)`)
const st = typeof after === 'string' ? { text: after } : await ev(`__probe.bubbleState ? __probe.bubbleState() : null`)
console.log('4.6 秒后', JSON.stringify(st))
const ok = st && st.visible && st.text === '这是新的一句，别收我'
console.log(ok ? 'PASS' : 'FAIL')
ws.close()
