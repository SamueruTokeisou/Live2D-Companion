#!/usr/bin/env node
/**
 * 事件驱动通路单测：合成 PointerEvent（带 screenX/screenY）走一遍
 * pointerdown → pointermove×N → pointerup，检查窗口是否按事件位移（而不是等轮询）。
 */
const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 9222)
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

const b0 = await ev(`shell.bounds()`)
const pick = await ev(`(() => {
  for (let y = 40; y < innerHeight - 40; y += 8) {
    for (let x = 20; x < innerWidth - 20; x += 8) {
      if (__probe.hitAt(x, y) === null && __probe.bodyAt(x, y)) return { x, y }
    }
  }
  return null
})()`)
if (!pick) { console.log('FAIL 没有可拖点'); ws.close(); process.exit(1) }
const s0 = { x: b0.x + pick.x, y: b0.y + pick.y }

// 合成按下 + 5 次移动（每次 +20px），全部带屏幕坐标
await ev(`(() => {
  const el = document.querySelector('#stage')
  const mk = (type, sx, sy) => { const e = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', clientX: ${pick.x}, clientY: ${pick.y}, screenX: sx, screenY: sy }); el.dispatchEvent(e) }
  mk('pointerdown', ${s0.x}, ${s0.y})
  for (let i = 1; i <= 5; i += 1) mk('pointermove', ${s0.x} + i * 20, ${s0.y})
  mk('pointerup', ${s0.x} + 100, ${s0.y})
  return true
})()`)
await sleep(500)
const b1 = await ev(`shell.bounds()`)
const moved = b1.x - b0.x
console.log(`窗口位移 ${moved}px（事件里发了 100px）`)
console.log(Math.abs(moved - 100) <= 3 ? 'PASS（事件驱动生效，不依赖轮询）' : 'FAIL')
ws.close()
