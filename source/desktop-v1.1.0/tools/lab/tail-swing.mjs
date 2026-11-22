// 量「甩胯」能把尾巴甩多远：固定参数写 HipAngleZ / ParamBodyAngleZ，测尾鳍最右/最下顶点位移。
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
const sleepy = (ms) => new Promise((r) => setTimeout(r, ms))

const res = await ev(`(async () => {
  const stage = __probe.refs().stage
  const im = stage.model.internalModel
  const core = stage.core
  const caps = window.__caps || (await fetch('/api/capabilities').then(r => r.json()))
  const byId = new Map((caps.parts || []).map(p => [p.id, p.name]))
  const partName = (i) => { try { const h = core.getPartId(i); return byId.get(typeof h === 'string' ? h : h.getString().s) || '' } catch { return '' } }
  const idx = []
  for (let i = 0; i < core.getDrawableCount(); i++) {
    let parent = -1
    try { parent = core.getDrawableParentPartIndex(i) } catch {}
    if (parent < 0) continue
    if (/尾|狗尾草/.test(partName(parent))) idx.push(i)
  }
  // 尾鳍 = 尾巴顶点里最靠右下的一批（取 x 最大的 8% 顶点）
  const collect = () => {
    const pts = []
    for (const i of idx) {
      let v
      try { v = im.getDrawableVertices(i) } catch { continue }
      if (!v || v.length < 6) continue
      for (let t = 0; t < v.length; t += 2) pts.push([v[t], v[t + 1]])
    }
    return pts
  }
  const stats = (pts) => {
    if (!pts.length) return null
    pts.sort((a, b) => b[0] - a[0])
    const tip = pts.slice(0, Math.max(1, Math.floor(pts.length * 0.08)))
    let sx = 0, sy = 0
    for (const p of tip) { sx += p[0]; sy += p[1] }
    return { n: pts.length, tipX: Math.round(sx / tip.length), tipY: Math.round(sy / tip.length) }
  }
  const write = (pid, v) => { try { stage.param.set(pid, v) } catch {} }

  // 关掉待机，避免被覆盖
  await shell.set({ idle: false })
  await new Promise(r => setTimeout(r, 1200))

  const out = {}
  const measure = async (label, vals) => {
    let stop = false
    const off = stage.onBeforeUpdate(() => { if (stop) return; for (const [k, v] of Object.entries(vals)) write(k, v) })
    await new Promise(r => setTimeout(r, 450))
    const s = stats(collect())
    stop = true
    off()
    out[label] = s
  }
  await measure('rest', {})
  for (const deg of [-25, -15, 15, 25]) await measure('hip' + deg, { HipAngleZ: deg, ParamBodyAngleZ: deg * 0.6 })
  for (const deg of [-25, 25]) await measure('body' + deg, { ParamBodyAngleZ: deg })
  await shell.set({ idle: true })
  return out
})()`)
console.log(JSON.stringify(res, null, 1))
writeFileSync('tmp/tail-swing.json', JSON.stringify(res, null, 1))
ws.close()
