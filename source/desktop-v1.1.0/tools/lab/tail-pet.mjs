// 摸尾巴回归：在尾巴热区上滑动 → 应触发「被摸尾巴」动作 + ＞＞/脸红 + tailPet 台词。
// 用法：node tools/lab/tail-pet.mjs [--port 9224]
import { writeFileSync } from 'node:fs'
const argv = process.argv.slice(2)
const port = Number(argv[argv.indexOf('--port') + 1] || 9224)
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
if (!page) { console.log('FAIL 没找到舞台页'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const send = (method, params) => new Promise((res, rej) => {
  const my = ++id
  const on = (e) => { const m = JSON.parse(e.data); if (m.id !== my) return; ws.removeEventListener('message', on); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }
  ws.addEventListener('message', on); ws.send(JSON.stringify({ id: my, method, params }))
})
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 找尾巴上的点（避开与身体重叠的洞）
const pt = await ev(`(() => {
  for (let y = 60; y < innerHeight - 60; y += 8) {
    for (let x = 20; x < innerWidth - 20; x += 8) {
      if (__probe.hitAt(x, y) === '尾巴') return { x, y }
    }
  }
  return null
})()`)
console.log('TAIL_POINT', JSON.stringify(pt))
if (!pt) { console.log('FAIL 没有尾巴热区'); ws.close(); process.exit(1) }

// 找一段「连续 60px 以上」的尾巴横线：尾巴热区是凸包挖洞，和腿重叠的地方 z 低，
// 点上去会判给腿，所以必须找一段真正连续的尾巴
const span = await ev(`(() => {
  let best = null
  for (let y = 40; y < innerHeight - 40; y += 6) {
    let run = 0, start = -1
    for (let x = 10; x <= innerWidth - 10; x += 4) {
      const isTail = __probe.hitAt(x, y) === '尾巴'
      if (isTail) { if (run === 0) start = x; run++ } else {
        if (run * 4 >= 60 && (!best || run * 4 > best.len)) best = { y, min: start, max: start + (run - 1) * 4, len: run * 4 }
        run = 0
      }
    }
    if (run * 4 >= 60 && (!best || run * 4 > best.len)) best = { y, min: start, max: start + (run - 1) * 4, len: run * 4 }
  }
  return best
})()`)
console.log('TAIL_SPAN', JSON.stringify(span))

const before = await ev(`({ bubble: document.querySelector('#bubble')?.textContent || '', idle: __probe.idleState?.() ?? null })`)
console.log('BEFORE', JSON.stringify({ bubble: before.bubble.slice(0, 20) }))

// 按住 → 沿这一行从尾巴左端摸到右端（保证始终在尾巴上）
const startX = span ? span.min + 6 : pt.x
const startY = span ? span.y : pt.y
await ev(`(() => {
  const el = document.querySelector('#stage')
  const o = { bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: 'mouse', clientX: ${startX}, clientY: ${startY} }
  el.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1 }))
  return true
})()`)
const endX = span ? span.max - 6 : startX + 40
const steps = 10
for (let i = 1; i <= steps; i++) {
  const x = Math.round(startX + ((endX - startX) * i) / steps)
  await ev(`(() => {
    const el = document.querySelector('#stage')
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, pointerType: 'mouse', clientX: ${x}, clientY: ${startY} }))
    return true
  })()`)
  await sleep(60)
}
await ev(`(() => {
  const el = document.querySelector('#stage')
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 7, pointerType: 'mouse', clientX: ${endX}, clientY: ${startY} }))
  return true
})()`)

await sleep(500)
const mid = await ev(`({
  bubble: document.querySelector('#bubble')?.textContent || '',
  idle: __probe.idleState?.() ?? null,
  exprs: (__probe.refs?.()?.stage ? null : null),
  layers: (() => { try { return __probe.layersName ? null : null } catch { return null } })(),
  active: __probe.poses?.() ?? null,
})`)
console.log('MID', JSON.stringify(mid, null, 1))

// 表情层：看看 ＞＜ / 脸红 有没有挂上（RPC 直接返回值，没有再包一层 value）
const expr = await ev(`__stageRpc('meta').then(r => (r?.active?.exprs || []))`)
console.log('EXPRS', JSON.stringify(expr))
console.log('HISTORY', JSON.stringify(await ev(`__probe.history?.() ?? null`)).slice(0, 500))

// 截图留证
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('tmp/tail-pet.png', Buffer.from(shot.data, 'base64'))
console.log('SHOT tmp/tail-pet.png')
ws.close()
