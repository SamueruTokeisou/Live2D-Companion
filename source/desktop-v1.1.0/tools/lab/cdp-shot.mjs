// 截取舞台窗口当前画面（CDP），输出 PNG
import fs from 'node:fs'
const port = Number(process.env.CDP_PORT || 9222)
const out = process.argv[2] || 'tmp/stage-shot.png'
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
if (!page) { console.error('找不到舞台页面'); process.exit(1) }
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
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('saved', out, fs.statSync(out).size, 'bytes')
ws.close()
