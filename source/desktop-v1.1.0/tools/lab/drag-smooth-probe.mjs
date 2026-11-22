#!/usr/bin/env node
/**
 * 平滑拖动测量：光标按 1px/4ms 连续移动（接近真实鼠标），
 * 用 rAF 记录窗口实际位置，看窗口更新节奏与渲染帧率。
 */
import { execFileSync } from 'node:child_process'

const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 9222)
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const send = (method, params) => new Promise((resolve, reject) => {
  const my = ++id
  const on = (e) => { const m = JSON.parse(e.data); if (m.id !== my) return; ws.removeEventListener('message', on); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) }
  ws.addEventListener('message', on)
  ws.send(JSON.stringify({ id: my, method, params }))
})
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const b0 = await ev(`shell.bounds()`)
const pick = await ev(`(() => {
  for (let y = 40; y < innerHeight - 40; y += 8) {
    for (let x = 20; x < innerWidth - 20; x += 8) {
      if (__probe.hitAt(x, y) === null && __probe.bodyAt(x, y)) return { x, y }
    }
  }
  return null
})()`)
if (!pick) { console.log('FAIL 没有可拖点'); ws.close(); process.exit(1) }
const sx0 = Math.round(b0.x + pick.x), sy0 = Math.round(b0.y + pick.y)
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${sx0}, ${sy0})`])
await sleep(350)

await ev(`__probe.winSampleStart(3000)`)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pick.x, y: pick.y, button: 'left', buttons: 1, clickCount: 1 })
await sleep(120)
// 1px 一步、约 4ms 一步、共 300px（约 1.2 秒），模拟真实平滑拖动
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.Windows.Forms;
   $sw=[Diagnostics.Stopwatch]::StartNew();
   foreach($i in 1..300){ [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point((${sx0} + $i), ${sy0}); while($sw.ElapsedMilliseconds -lt $i*4){} }`])
await sleep(250)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pick.x + 300, y: pick.y, button: 'left', buttons: 0, clickCount: 1 })
await sleep(500)
const win = await ev(`__probe.winSamples()`)

const span = win.length ? win[win.length - 1].t - win[0].t : 0
const frames = []
for (let i = 1; i < win.length; i += 1) frames.push(win[i].t - win[i - 1].t)
frames.sort((a, b) => a - b)
const changes = []
let prev = win[0]
for (const s of win.slice(1)) if (s.x !== prev.x || s.y !== prev.y) { changes.push({ t: s.t, dt: s.t - prev.t, d: Math.abs(s.x - prev.x) + Math.abs(s.y - prev.y) }); prev = s }
const cdt = changes.map((c) => c.dt).sort((a, b) => a - b)
const cd = changes.map((c) => c.d).sort((a, b) => a - b)
console.log(`帧：${win.length} 帧 / ${span}ms  rAF 间隔 中位 ${frames[Math.floor(frames.length / 2)]}ms 最大 ${frames[frames.length - 1]}ms`)
console.log(`窗口位置：变化 ${changes.length} 次  间隔 中位 ${cdt[Math.floor(cdt.length / 2)]}ms 最大 ${cdt[cdt.length - 1]}ms  步长 中位 ${cd[Math.floor(cd.length / 2)]}px 最大 ${cd[cd.length - 1]}px`)
const longFrames = frames.filter((f) => f > 25).length
console.log(`掉帧（>25ms 的间隔）：${longFrames} 次`)
ws.close()
