// 帧内耗时拆解：update / render / resize / 绘制调用数
const port = Number(process.argv[2] || 9224)
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const send = (m, p) => new Promise((res, rej) => {
  const my = ++id
  const on = (e) => { const x = JSON.parse(e.data); if (x.id !== my) return; ws.removeEventListener('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result) }
  ws.addEventListener('message', on); ws.send(JSON.stringify({ id: my, method: m, params: p }))
})
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await sleep(2500)
// 装钩子：模型 update、整帧 render、drawElements 次数
console.log('HOOK', JSON.stringify(await ev(`(()=>{
  const {app, model} = __probe.refs()
  if (!app || !model) return {error:'no refs'}
  window.__m = {upd:[], rend:[], draws:0, frames:0}
  if (!app.__origRender) {
    app.__origRender = app.render.bind(app)
    app.render = () => { const a=performance.now(); app.__origRender(); window.__m.rend.push(performance.now()-a); window.__m.frames++ }
  }
  if (!model.__origUpdate) {
    model.__origUpdate = model.update.bind(model)
    model.update = (dt) => { const a=performance.now(); model.__origUpdate(dt); window.__m.upd.push(performance.now()-a) }
  }
  const gl = app.renderer.gl
  if (!gl.__origDraw) {
    gl.__origDraw = gl.drawElements.bind(gl)
    gl.drawElements = (...a) => { window.__m.draws++; return gl.__origDraw(...a) }
  }
  return {ok:true, canvas:[app.renderer.width, app.renderer.height], screen:[app.screen.width, app.screen.height]}
})()`)))

await sleep(3000)
console.log('FRAME', JSON.stringify(await ev(`(()=>{const m=window.__m; const avg=a=>+(a.reduce((s,v)=>s+v,0)/Math.max(1,a.length)).toFixed(2)
  const r={frames:m.frames, updateAvg:avg(m.upd), renderAvg:avg(m.rend), drawCallsPerFrame:+(m.draws/Math.max(1,m.frames)).toFixed(1)};
  m.upd=[]; m.rend=[]; m.draws=0; m.frames=0; return r})()`)))

// resize 成本：连续改 10 次尺寸，量每次 stage.resize 的耗时（通过 window resize 触发）
console.log('RESIZE', JSON.stringify(await ev(`(async()=>{
  const st = __probe.refs().stage
  const app = __probe.refs().app
  const sizes=[]; const t0=performance.now()
  for (let i=0;i<8;i++){
    const w = 700 + i*20, h = Math.round(w*1.83)
    const a = performance.now()
    app.renderer.resize(w,h)
    sizes.push(+(performance.now()-a).toFixed(2))
    await new Promise(r=>setTimeout(r,30))
  }
  return { perResize: sizes, totalMs: +(performance.now()-t0).toFixed(0), now:[app.renderer.width,app.renderer.height] }
})()`)))

// 当前窗口尺寸（作为对照）
console.log('WIN', JSON.stringify(await ev(`shell.bounds()`)))
ws.close()
