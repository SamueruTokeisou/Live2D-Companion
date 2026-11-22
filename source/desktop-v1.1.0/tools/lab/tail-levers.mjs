// 找出哪些参数能带动尾巴网格：逐个覆写，量尾巴顶点质心位移。
// 用法：node tools/lab/tail-levers.mjs [--port 9224]
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const res = await ev(`(async () => {
  const refs = __probe.refs()
  const stage = refs.stage
  const im = stage.model.internalModel
  const core = stage.core
  const caps = window.__caps || (await fetch('/api/capabilities').then(r => r.json()))
  const byId = new Map((caps.parts || []).map(p => [p.id, p.name]))
  const partName = (i) => { try { return byId.get(core.getPartId(i).getString ? core.getPartId(i).getString().s : core.getPartId(i)) || '' } catch { return '' } }
  // 尾巴 drawable 索引
  const idx = []
  for (let i = 0; i < core.getDrawableCount(); i++) {
    let parent = -1
    try { parent = core.getDrawableParentPartIndex(i) } catch {}
    if (parent < 0) continue
    if (/尾|狗尾草/.test(partName(parent))) idx.push(i)
  }
  const centroid = () => {
    let sx = 0, sy = 0, n = 0
    for (const i of idx) {
      let v
      try { v = im.getDrawableVertices(i) } catch { continue }
      if (!v || v.length < 6) continue
      for (let t = 0; t < v.length; t += 2) { sx += v[t]; sy += v[t + 1]; n++ }
    }
    return n ? { x: sx / n, y: sy / n, n } : null
  }
  const base = centroid()
  if (!base) return { error: 'no tail vertices' }

  const ids = ['ParamBodyAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'HipAngleZ', 'HipAngleX', 'ParamAngleZ', 'ParamAngleX', 'ParamAngleY', 'Movement1', 'Movement2', 'Param44', 'Param56', 'Param57', 'Param62', 'Param60']
  const out = []
  for (const pid of ids) {
    const info = stage.param.info(pid)
    if (!info) { out.push({ id: pid, missing: true }); continue }
    const v = Math.max(info.min, Math.min(info.max, 0.8))
    __probe.param(pid, v, 'Add')
    await new Promise(r => setTimeout(r, 220))
    const c = centroid()
    __probe.clear()
    await new Promise(r => setTimeout(r, 220))
    out.push({ id: pid, applied: v, dx: c ? Math.round(c.x - base.x) : null, dy: c ? Math.round(c.y - base.y) : null })
  }
  return { drawables: idx.length, base: { x: Math.round(base.x), y: Math.round(base.y), n: base.n }, out }
})()`)
console.log(JSON.stringify(res, null, 1).slice(0, 2600))
writeFileSync('tmp/tail-levers.json', JSON.stringify(res, null, 1))
ws.close()
