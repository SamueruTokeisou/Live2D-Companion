#!/usr/bin/env node
/**
 * 缩放锚点验证：在「头」热区上按中键滚一格，检查
 *   1) 缩放步进是否约 1.6%
 *   2) 光标下那个模型点缩放后是否还压在同一个屏幕位置（偏移应 < 2px）
 * 用法：node tools/lab/zoom-probe.mjs --port 9222
 */
const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 9222)

async function pageTarget() {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  return list.find((t) => t.type === 'page' && /app\//.test(t.url))
}

function cdp(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9)
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id !== id) return
      ws.removeEventListener('message', onMsg)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const evaluate = async (ws, expression) => {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}

const t = await pageTarget()
if (!t) { console.error('没有找到舞台页面'); process.exit(1) }
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const before = await evaluate(ws, `(() => {
  const box = __probe.regionBox('头')
  // 头热区上面还盖着「额头」等细分热区：扫一个确实命中「头」的点
  let x = box.left + box.width * 0.5, y = box.top + box.height * 0.5
  for (let dy = 0.3; dy <= 0.8; dy += 0.02) {
    for (let dx = 0.25; dx <= 0.75; dx += 0.02) {
      const px = box.left + box.width * dx
      const py = box.top + box.height * dy
      if (__probe.hitAt(px, py) === '头') { x = px; y = py; dy = 9; break }
    }
  }
  const m = __probe.modelAt(x, y)
  return { zoom: __probe.zoom(), x, y, sx: window.screenX + x, sy: window.screenY + y, mx: m.x, my: m.y, hit: __probe.hitAt(x, y) }
})()`)
console.log('前置：zoom', before.zoom, '命中', before.hit, '光标', before.x.toFixed(0), before.y.toFixed(0), '屏幕', before.sx.toFixed(0), before.sy.toFixed(0))

// 滚两格（模拟真实节奏：每格 30ms）
for (let i = 0; i < 2; i += 1) {
  await evaluate(ws, `(() => {
    window.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -100, buttons: 4, deltaMode: 0,
      clientX: ${before.x}, clientY: ${before.y},
      screenX: ${before.sx}, screenY: ${before.sy},
      bubbles: true, cancelable: true,
    }))
    return true
  })()`)
  await sleep(30)
}
await sleep(500)

const after = await evaluate(ws, `(() => {
  const c = __probe.clientAt(${before.mx}, ${before.my})
  return { zoom: __probe.zoom(), cx: c.x, cy: c.y, wx: window.screenX, wy: window.screenY }
})()`)
const driftX = Math.abs(after.wx + after.cx - before.sx)
const driftY = Math.abs(after.wy + after.cy - before.sy)
const perStep = ((after.zoom / before.zoom) ** 0.5 - 1) * 100
console.log(`结果：zoom ${before.zoom} → ${after.zoom}（每格 ${perStep.toFixed(2)}%）`)
console.log(`锚点偏差：${driftX.toFixed(1)}px / ${driftY.toFixed(1)}px`)
console.log(driftX < 2 && driftY < 2 && Math.abs(perStep) > 0.8 && Math.abs(perStep) < 3 ? 'PASS' : 'FAIL')
ws.close()
