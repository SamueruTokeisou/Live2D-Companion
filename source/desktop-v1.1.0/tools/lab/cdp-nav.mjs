const port = Number(process.env.CDP_PORT || 9222)
const target = process.argv[2]
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
if (!page) { console.error('no page'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const send = (method, params) => new Promise((resolve, reject) => {
  const my = ++id
  const on = (e) => {
    const m = JSON.parse(e.data)
    if (m.id !== my) return
    ws.removeEventListener('message', on)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
  ws.addEventListener('message', on)
  ws.send(JSON.stringify({ id: my, method, params }))
})
await send('Page.navigate', { url: target })
console.log('navigated to', target)
ws.close()
