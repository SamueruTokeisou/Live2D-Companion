// 量「被摸尾巴」到底有没有动：直接触发动作，采样尾巴网格质心 + 截图。
import { writeFileSync } from 'node:fs'
const argv = process.argv.slice(2)
const port = Number(argv[argv.indexOf('--port') + 1] || 9224)
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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`tmp/${name}.png`, Buffer.from(r.data, 'base64'))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 关掉待机，安静环境
await ev(`shell.set({ idle: false })`)
await sleep(1800)
const base = await ev(`__probe.dynZones().tail`)
console.log('BASE', JSON.stringify(base))
await shot('tail-wag-0')

await ev(`__probe.idlePlay?.('被摸尾巴') ?? __stageRpc('idle', { mode: 'play', name: '被摸尾巴' })`)
const samples = []
for (let i = 0; i < 10; i++) {
  await sleep(140)
  const t = await ev(`__probe.dynZones().tail`)
  samples.push(t ? { x: Math.round((t.minX + t.maxX) / 2), y: Math.round((t.minY + t.maxY) / 2) } : null)
  if (i === 4) await shot('tail-wag-mid')
}
await shot('tail-wag-end')
console.log('TAIL_CENTROIDS', JSON.stringify(samples))
const st = await ev(`__probe.idleState?.()`)
console.log('IDLE', JSON.stringify(st))
await ev(`shell.set({ idle: true })`)
ws.close()
