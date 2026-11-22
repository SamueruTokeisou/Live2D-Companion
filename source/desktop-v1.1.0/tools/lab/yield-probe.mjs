#!/usr/bin/env node
/**
 * 头部让位分档验证：不同头部幅度的动作，视线强度应该不一样。
 *   挥手打招呼 4° → 1.0（完全不让位）
 *   戴铁盆     7° → 约 0.62（打折）
 *   别过头    26° → 0（完全交给动作）
 * 用法：node tools/lab/yield-probe.mjs --port 9222
 */
const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 9222)
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
    if (m.error) return reject(new Error(JSON.stringify(m.error)))
    if (m.result.exceptionDetails) return reject(new Error(m.result.exceptionDetails.text))
    resolve(m.result.result?.value)
  }
  ws.addEventListener('message', on)
  ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cases = [['挥手打招呼', 4], ['戴铁盆', 7], ['别过头', 26]]
let pass = 0
for (const [name, expectDeg] of cases) {
  await ev(`__probe.idlePlay('${name}')`)
  await sleep(420)
  const s = await ev(`({ s: __probe.gazeStrength(), y: __probe.yieldHead() })`)
  const k = (12 - expectDeg) / 8
  const want = expectDeg <= 4 ? 1 : expectDeg >= 12 ? 0 : k
  const ok = Math.abs(s.s - want) < 0.12
  if (ok) pass += 1
  console.log(`${name.padEnd(6, '　')} 幅度${String(expectDeg).padStart(3)}°  期望 ${want.toFixed(2)}  实测 ${s.s?.toFixed(2)}  yield=${s.y}  ${ok ? 'OK' : 'FAIL'}`)
  await sleep(1400)
}
console.log(pass === cases.length ? `ALL PASS (${pass}/${cases.length})` : `FAIL (${pass}/${cases.length})`)
ws.close()
