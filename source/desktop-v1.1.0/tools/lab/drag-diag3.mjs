#!/usr/bin/env node
/** 隔离测试：直接调 shell.dragBegin()，只挪系统光标，看窗口动不动（绕开渲染层） */
import { execFileSync } from 'node:child_process'
const port = 9222
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
const curRaw = execFileSync('powershell.exe', ['-NoProfile', '-Command',
  'Add-Type -AssemblyName System.Windows.Forms; "$([System.Windows.Forms.Cursor]::Position.X),$([System.Windows.Forms.Cursor]::Position.Y)"']).toString().trim()
const [cx0, cy0] = curRaw.split(',').map(Number)
console.log('bounds', JSON.stringify(b0), 'cursor', cx0, cy0)
await ev(`shell.dragBegin(); 'ok'`)
await sleep(200)
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  'Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(($p.X + 120), $p.Y)'])
await sleep(500)
const b1 = await ev(`shell.bounds()`)
await ev(`shell.dragEnd(); 'ok'`)
await sleep(200)
console.log('moved', b1.x - b0.x, 'px')
console.log(b1.x - b0.x !== 0 ? 'MAIN-PATH OK' : 'MAIN-PATH DEAD')
ws.close()
