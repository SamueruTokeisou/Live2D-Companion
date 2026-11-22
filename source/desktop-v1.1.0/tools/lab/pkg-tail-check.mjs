// 打包版实测：摸尾巴 → 采样尾鳍尖位移 + 截图（判断到底动没动、动多少）
import { writeFileSync } from 'node:fs'
const argv = process.argv.slice(2)
const port = Number(argv[argv.indexOf('--port') + 1] || 9223)
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
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
const shot = async (n) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`tmp/${n}.png`, Buffer.from(r.data, 'base64'))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 安装「尾鳍尖」采样器：只取尾巴/狗尾草部件下的 drawable，量最右端那撮顶点的质心
await ev(`(async () => {
  const stage = __probe.refs().stage
  const im = stage.model.internalModel
  const core = stage.core
  const caps = await fetch('/api/capabilities').then(r => r.json())
  const byId = new Map((caps.parts || []).map(p => [p.id, p.name]))
  const partName = (i) => { try { const h = core.getPartId(i); return byId.get(typeof h === 'string' ? h : h.getString().s) || '' } catch { return '' } }
  window.__tailIdx = []
  for (let i = 0; i < core.getDrawableCount(); i++) {
    let p = -1
    try { p = core.getDrawableParentPartIndex(i) } catch {}
    if (p < 0) continue
    if (/尾|狗尾草/.test(partName(p))) window.__tailIdx.push(i)
  }
  window.__tailTip = () => {
    const pts = []
    for (const i of window.__tailIdx) {
      let v
      try { v = im.getDrawableVertices(i) } catch { continue }
      if (!v || v.length < 6) continue
      for (let t = 0; t < v.length; t += 2) if (isFinite(v[t]) && isFinite(v[t + 1])) pts.push([v[t], v[t + 1]])
    }
    if (!pts.length) return null
    pts.sort((a, b) => b[0] - a[0])
    const tip = pts.slice(0, Math.max(1, Math.floor(pts.length * 0.08)))
    let sx = 0, sy = 0
    for (const p of tip) { sx += p[0]; sy += p[1] }
    return { x: Math.round(sx / tip.length), y: Math.round(sy / tip.length), n: window.__tailIdx.length }
  }
  return window.__tailIdx.length
})()`)

// 找一段连续的尾巴横线（同 tail-pet.mjs）
const span = await ev(`(() => {
  let best = null
  for (let y = 40; y < innerHeight - 40; y += 6) {
    let run = 0, start = -1
    for (let x = 10; x <= innerWidth - 10; x += 4) {
      if (__probe.hitAt(x, y) === '尾巴') { if (run === 0) start = x; run++ } else {
        if (run * 4 >= 60 && (!best || run * 4 > best.len)) best = { y, min: start, max: start + (run - 1) * 4, len: run * 4 }
        run = 0
      }
    }
  }
  return best
})()`)
console.log('SPAN', JSON.stringify(span))
if (!span) { console.log('FAIL 没尾巴热区'); ws.close(); process.exit(1) }

const rest = await ev(`__tailTip()`)
console.log('REST_TIP', JSON.stringify(rest))

const startX = span.min + 6, startY = span.y, endX = span.max - 6
await ev(`(() => {
  const el = document.querySelector('#stage')
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 11, pointerType: 'mouse', clientX: ${startX}, clientY: ${startY} }))
  return true
})()`)
for (let i = 1; i <= 10; i++) {
  const x = Math.round(startX + ((endX - startX) * i) / 10)
  await ev(`(() => {
    const el = document.querySelector('#stage')
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 11, pointerType: 'mouse', clientX: ${x}, clientY: ${startY} }))
    return true
  })()`)
  await sleep(50)
}
await ev(`(() => {
  const el = document.querySelector('#stage')
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 11, pointerType: 'mouse', clientX: ${endX}, clientY: ${startY} }))
  return true
})()`)

const tips = []
for (let i = 0; i < 14; i++) {
  await sleep(160)
  const t = await ev(`__tailTip()`)
  tips.push(t)
  if (i === 2) await shot('pkg-wag-1')
  if (i === 6) await shot('pkg-wag-2')
  if (i === 10) await shot('pkg-wag-3')
}
console.log('TIPS', JSON.stringify(tips))
const xs = tips.filter(Boolean).map((t) => t.x)
const ys = tips.filter(Boolean).map((t) => t.y)
console.log('RANGE', JSON.stringify({ dx: Math.max(...xs) - Math.min(...xs), dy: Math.max(...ys) - Math.min(...ys) }))
console.log('IDLE', JSON.stringify(await ev(`__probe.idleState?.()`)))
console.log('BUBBLE', JSON.stringify(await ev(`document.querySelector('#bubble')?.textContent || ''`)))
ws.close()
