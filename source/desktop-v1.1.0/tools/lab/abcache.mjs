// A/B：同窗口尺寸下，三种缓存组合的每帧耗时对比
const port = Number(process.argv[2] || 9224)
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
const base = new URL(page.url)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const send = (m, p) => new Promise((res, rej) => {
  const my = ++id
  const on = (e) => { const x = JSON.parse(e.data); if (x.id !== my) return; ws.removeEventListener('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result) }
  ws.addEventListener('message', on); ws.send(JSON.stringify({ id: my, method: m, params: p }))
})
const ev = async (e, ms = 60000) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const configs = [
  { name: 'baseline', q: 'noglcache&nomeshcache' },
  { name: 'mesh', q: 'noglcache' },
  { name: 'mesh+state', q: '' },
]

for (const cfg of configs) {
  const url = `${base.origin}${base.pathname}?core=native&${cfg.q}`
  await send('Page.navigate', { url })
  await sleep(1000)
  // 等模型就绪
  for (let i = 0; i < 40; i++) {
    const ok = await ev(`!!(window.__probe && __probe.refs().model && __probe.refs().app)`).catch(() => false)
    if (ok) break
    await sleep(300)
  }
  await sleep(2500)
  await ev(`(()=>{
    if (window.__tk) return 'has'
    const app=__probe.refs().app
    window.__tk={n:0,sum:0,max:0,gaps:[],t0:0,last:0}
    app.ticker.add(()=>{const f=window.__tk;const t=performance.now();if(f.last)f.gaps.push(t-f.last);f.last=t;f.t0=t},null,100)
    app.ticker.add(()=>{const f=window.__tk;f.sum+=performance.now()-f.t0;f.n++},null,-40)
    return 'ok'
  })()`)
  await sleep(2600)
  const r = await ev(`(()=>{const f=window.__tk;const g=f.gaps.slice(2).sort((a,b)=>a-b);
    return {frames:f.n, tick:+(f.sum/Math.max(1,f.n)).toFixed(2), gapP50:+g[Math.floor(g.length/2)].toFixed(2), gapP95:+g[Math.floor(g.length*0.95)].toFixed(2)}})()`)
  console.log(cfg.name.padEnd(11), JSON.stringify(r))
}
ws.close()
