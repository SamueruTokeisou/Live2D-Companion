#!/usr/bin/env node
/**
 * 左键/右键分工回归：左键只互动（拖不搬窗），右键按住搬窗，右键点一下仍然弹工具栏。
 * 用法：node tools/lab/left-vs-right.mjs [--port 9224]
 */
const argv = process.argv.slice(2)
const port = Number(argv[argv.indexOf('--port') + 1] || 9224)
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
if (!page) { console.log('FAIL 没找到舞台页'); process.exit(1) }
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || ''))
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const bounds = () => ev('shell.bounds()')
const b0 = await bounds()
console.log('BOUNDS0', JSON.stringify(b0))

// 找点：身上但不在热区（左键拖这里过去会搬窗）、以及额头/头热区
const pts = await ev(`(() => {
  const out = { body: null, forehead: null, head: null }
  for (let y = 20; y < innerHeight - 20; y += 6) {
    for (let x = 10; x < innerWidth - 10; x += 6) {
      const r = __probe.hitAt(x, y)
      if (!out.forehead && r === '额头') out.forehead = { x, y }
      if (!out.head && r === '头') out.head = { x, y }
      if (!out.body && !r && __probe.bodyAt(x, y)) out.body = { x, y }
    }
  }
  return out
})()`)
console.log('POINTS', JSON.stringify(pts))
if (!pts.body) { console.log('FAIL 没有可测的身体点'); process.exit(1) }

const drag = async (button, p, dx, dy) => {
  const sx = b0.x + p.x
  const sy = b0.y + p.y
  const steps = [[0, 0], [dx, dy], [dx * 2, dy * 2]]
  const btnsDown = button === 2 ? 2 : 1
  await ev(`(() => {
    const el = document.querySelector('#stage')
    const mk = (type, px, py, buttons) => new PointerEvent(type, {
      bubbles: true, cancelable: true, button: ${button}, buttons,
      pointerId: 1, pointerType: 'mouse',
      clientX: ${p.x}, clientY: ${p.y}, screenX: px, screenY: py,
    })
    el.dispatchEvent(mk('pointerdown', ${sx}, ${sy}, ${btnsDown}))
    ${steps.slice(1).map(([mx, my]) => `el.dispatchEvent(mk('pointermove', ${sx + mx}, ${sy + my}, ${btnsDown}))`).join('\n    ')}
    return true
  })()`)
  await sleep(260)
  await ev(`(() => {
    const el = document.querySelector('#stage')
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: ${button}, buttons: 0, pointerId: 1, pointerType: 'mouse', clientX: ${p.x}, clientY: ${p.y}, screenX: ${sx + dx * 2}, screenY: ${sy + dy * 2} }))
    return true
  })()`)
  await sleep(260)
}

// ① 左键拖：窗口不该动
await drag(0, pts.body, 60, 40)
const b1 = await bounds()
console.log('LEFT_DRAG', JSON.stringify({ dx: b1.x - b0.x, dy: b1.y - b0.y, expect: '0/0' }))

// ② 右键拖：窗口该跟着走
await drag(2, pts.body, 60, 40)
const b2 = await bounds()
console.log('RIGHT_DRAG', JSON.stringify({ dx: b2.x - b1.x, dy: b2.y - b1.y, expect: '120/80' }))

// ③ 右键点一下（不拖）→ 右键菜单/工具栏该弹
const toolsHidden = await ev(`document.querySelector('#tools')?.classList.contains('hidden')`)
await ev(`(() => {
  const el = document.querySelector('#stage')
  const sx = ${b2.x} + ${pts.body.x}, sy = ${b2.y} + ${pts.body.y}
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 1, pointerType: 'mouse', clientX: ${pts.body.x}, clientY: ${pts.body.y}, screenX: sx, screenY: sy }))
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, buttons: 0, pointerId: 1, pointerType: 'mouse', clientX: ${pts.body.x}, clientY: ${pts.body.y}, screenX: sx, screenY: sy }))
  window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${pts.body.x}, clientY: ${pts.body.y} }))
  return true
})()`)
await sleep(400)
const toolsAfter = await ev(`document.querySelector('#tools')?.classList.contains('hidden')`)
console.log('RIGHT_CLICK_TOOLS', JSON.stringify({ before: toolsHidden, after: toolsAfter, expect: 'after=false' }))

// ④ 左键点额头 → 应触发互动（toast「表情：…」）
if (pts.forehead || pts.head) {
  const p = pts.forehead || pts.head
  await ev(`(() => {
    const el = document.querySelector('#stage')
    const sx = ${b2.x} + ${p.x}, sy = ${b2.y} + ${p.y}
    const o = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: ${p.x}, clientY: ${p.y}, screenX: sx, screenY: sy }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1 }))
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }))
    return true
  })()`)
  await sleep(400)
  const tap = await ev(`({ toast: document.querySelector('#toast')?.textContent || '', bubble: document.querySelector('#bubble')?.textContent?.slice(0, 30) || '' })`)
  console.log('LEFT_TAP', JSON.stringify({ point: p, ...tap }))
} else {
  console.log('LEFT_TAP', 'skip 没找到额头/头热区')
}

// 还原窗口位置
await ev(`shell.set?.({})`)
await drag(2, pts.body, -120, -80)
const b3 = await bounds()
console.log('RESTORED', JSON.stringify({ dx: b3.x - b0.x, dy: b3.y - b0.y }))
ws.close()
