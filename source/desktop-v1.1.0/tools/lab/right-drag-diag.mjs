// 右键搬窗诊断：直接调 preload 的 dragBegin/dragMove，看主进程动不动；再看事件层有没有启动拖动。
const port = Number(process.argv[2] || 9224)
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

const b0 = await ev('shell.bounds()')
console.log('B0', JSON.stringify(b0))
console.log('SHELL_KEYS', JSON.stringify(await ev(`Object.keys(window.shell || {})`)))
console.log('DRAG_API', JSON.stringify(await ev(`({ begin: typeof shell.dragBegin, move: typeof shell.dragMove, end: typeof shell.dragEnd })`)))

// 直接走 IPC：应该搬窗
await ev(`shell.dragBegin(${b0.x + 100}, ${b0.y + 100})`)
await sleep(60)
await ev(`shell.dragMove(${b0.x + 200}, ${b0.y + 160})`)
await sleep(120)
await ev(`shell.dragEnd()`)
await sleep(200)
const b1 = await ev('shell.bounds()')
console.log('DIRECT_IPC', JSON.stringify({ dx: b1.x - b0.x, dy: b1.y - b0.y }))

// 事件层：合成右键按下，看拖动状态
await ev(`(() => {
  const el = document.querySelector('#stage')
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 1, pointerType: 'mouse', clientX: 256, clientY: 92, screenX: ${b1.x + 256}, screenY: ${b1.y + 92} }))
  return true
})()`)
await sleep(150)
console.log('AFTER_DOWN', JSON.stringify(await ev(`({ drag: __probe.dragState?.(), bounds: null })`)))
await ev(`(() => {
  const el = document.querySelector('#stage')
  el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 1, pointerType: 'mouse', clientX: 256, clientY: 92, screenX: ${b1.x + 316}, screenY: ${b1.y + 132} }))
  return true
})()`)
await sleep(300)
const b2 = await ev('shell.bounds()')
console.log('EVENT_MOVE', JSON.stringify({ dx: b2.x - b1.x, dy: b2.y - b1.y }))
await ev(`(() => { document.querySelector('#stage').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, buttons: 0, pointerId: 1, pointerType: 'mouse', clientX: 256, clientY: 92, screenX: ${b1.x + 316}, screenY: ${b1.y + 132} })); return true })()`)
await sleep(200)
const b3 = await ev('shell.bounds()')
console.log('AFTER_UP', JSON.stringify({ dx: b3.x - b2.x, dy: b3.y - b2.y }))
ws.close()
