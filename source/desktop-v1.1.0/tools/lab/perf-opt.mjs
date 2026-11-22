// 性能回归探针：帧时间 + 掩码读回面积 + 网格上传统计（可开关网格缓存做 A/B）

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

const measureFrames = (ms = 3000) => ev(`new Promise((res)=>{const t0=performance.now();const d=[];let last=t0;
  function f(t){ if(last!==t0) d.push(t-last); last=t;
    if(t-t0<${ms}) requestAnimationFrame(f); else { const a=d.slice().sort((x,y)=>x-y); res({frames:d.length, avg:+(d.reduce((s,v)=>s+v,0)/d.length).toFixed(2), p50:+a[Math.floor(a.length/2)].toFixed(2), p95:+a[Math.floor(a.length*0.95)].toFixed(2), max:+a[a.length-1].toFixed(2)}) }
  } requestAnimationFrame(f)})`)

await sleep(2500)
console.log('MASK', JSON.stringify(await ev(`__probe.mask()`)))
console.log('MESH', JSON.stringify(await ev(`__probe.mesh?.()`)))
console.log('FRAMES_CACHE_ON', JSON.stringify(await measureFrames(3000)))
console.log('MESH2', JSON.stringify(await ev(`__probe.mesh?.()`)))


// A/B：卸掉缓存再测同样的 3 秒
await ev(`__probe.meshOff()`)
await sleep(600)
console.log('FRAMES_CACHE_OFF', JSON.stringify(await measureFrames(3000)))

ws.close()
