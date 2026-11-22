#!/usr/bin/env node
/**
 * 缩放语义验证：滚一格后，窗口矩形是否按「绕光标缩放 k 倍」变化。
 * 用户给的例子：(0,0)-(3,4)、光标 (1,1)、2 倍 → (-1,-1)-(5,7)
 * 这里逐格验证：w1≈w0·k，h1≈h0·k，x1≈sx−(sx−x0)·k，y1 同理，
 * 并且光标下那个模型点仍然在光标下。
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
const z0 = await ev(`__probe.zoom()`)
const pick = await ev(`(() => {
  const box = __probe.regionBox('头')
  for (let dy = 0.3; dy <= 0.8; dy += 0.02) {
    for (let dx = 0.25; dx <= 0.75; dx += 0.02) {
      const x = box.left + box.width * dx, y = box.top + box.height * dy
      if (__probe.hitAt(x, y) === '头') { const m = __probe.modelAt(x, y); return { x, y, mx: m.x, my: m.y, sx: window.screenX + x, sy: window.screenY + y } }
    }
  }
  return null
})()`)
if (!pick) { console.log('FAIL 找不到头顶热点'); ws.close(); process.exit(1) }
console.log(`起点 bounds=${JSON.stringify(b0)} zoom=${z0} 光标屏幕=(${pick.sx.toFixed(0)},${pick.sy.toFixed(0)})`)

await ev(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, buttons: 4, clientX: ${pick.x}, clientY: ${pick.y}, screenX: ${pick.sx}, screenY: ${pick.sy}, bubbles: true, cancelable: true }))`)
await sleep(600)

const b1 = await ev(`shell.bounds()`)
const z1 = await ev(`__probe.zoom()`)
const c1 = await ev(`__probe.clientAt(${pick.mx}, ${pick.my})`)
const wx = await ev(`window.screenX`)
const wy = await ev(`window.screenY`)
const k = z1 / z0
const exp = {
  w: Math.round(b0.width * k),
  h: Math.round(b0.height * k),
  x: Math.round(pick.sx - (pick.sx - b0.x) * k),
  y: Math.round(pick.sy - (pick.sy - b0.y) * k),
}
const dw = Math.abs(b1.width - exp.w), dh = Math.abs(b1.height - exp.h)
const dx = Math.abs(b1.x - exp.x), dy = Math.abs(b1.y - exp.y)
const drift = Math.hypot(wx + c1.x - pick.sx, wy + c1.y - pick.sy)
console.log(`k=${k.toFixed(4)}  实际 ${b1.width}×${b1.height} @${b1.x},${b1.y}`)
console.log(`期望 ${exp.w}×${exp.h} @${exp.x},${exp.y}   偏差 w${dw} h${dh} x${dx} y${dy}`)
console.log(`光标下模型点偏移 ${drift.toFixed(1)}px`)
const ok = dw <= 1 && dh <= 1 && dx <= 2 && dy <= 2 && drift < 2
console.log(ok ? 'PASS' : 'FAIL')
ws.close()
