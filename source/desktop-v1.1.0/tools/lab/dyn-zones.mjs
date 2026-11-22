// 动态热区可行性测量：连续采样各段包围盒，看耗时与待机抖动幅度。
// 用法：node tools/lab/dyn-zones.mjs [--port 9224] [--n 30]
const argv = process.argv.slice(2)
const port = Number(argv[argv.indexOf('--port') + 1] || 9224)
const n = Number(argv[argv.indexOf('--n') + 1] || 30)
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

const samples = await ev(`(async () => {
  // 先关掉待机动作：否则 2–4 秒里可能正好在演「伸懒腰 / 东张西望」，
  // 抖动量全是动作幅度，量不出「同一姿势下几何自己漂多少」。
  const prev = (await shell.get()).idle !== false
  await shell.set({ idle: false })
  await new Promise((r) => setTimeout(r, 1600))   // 等正在演的动作彻底收掉、姿势回稳
  const out = []
  for (let i = 0; i < ${n}; i++) {
    out.push(__probe.dynZones())
    await new Promise((r) => setTimeout(r, 100))
  }
  await shell.set({ idle: prev })
  return out
})()`)

const bands = ['head', 'chest', 'waist', 'skirt', 'legs', 'tail', 'body']
const msList = samples.map((s) => s.ms).filter((x) => typeof x === 'number')
const stat = (arr) => {
  const s = arr.slice().sort((a, b) => a - b)
  return { min: +s[0].toFixed(3), med: +s[Math.floor(s.length / 2)].toFixed(3), max: +s[s.length - 1].toFixed(3) }
}
console.log('COST_MS', JSON.stringify(stat(msList)), 'n=' + msList.length, 'parts=' + (samples[0]?.parts ?? '?'))
console.log('PARTS', samples[0]?.parts)

for (const b of bands) {
  const boxes = samples.map((s) => s[b]).filter(Boolean)
  if (!boxes.length) { console.log('BAND', b, 'none'); continue }
  const xs = boxes.flatMap((v) => [v.minX, v.maxX])
  const ys = boxes.flatMap((v) => [v.minY, v.maxY])
  console.log('BAND', b, JSON.stringify({
    x: [Math.round(Math.min(...xs)), Math.round(Math.max(...xs))],
    y: [Math.round(Math.min(...ys)), Math.round(Math.max(...ys))],
    driftX: Math.round(Math.max(...xs) - Math.min(...xs)),
    driftY: Math.round(Math.max(...ys) - Math.min(...ys)),
  }))
}

// 与当前静态热区比一比：动态盒子 vs 存着的热区
const staticZones = await ev(`__stageRpc('regions').then(r => (r||[]).map(z => ({ name: z.name, box: (() => { const xs = z.points.map(p=>p[0]); const ys = z.points.map(p=>p[1]); return [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))] })() })))`)
console.log('STATIC', JSON.stringify(staticZones))
ws.close()
