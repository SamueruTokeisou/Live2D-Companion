#!/usr/bin/env node
/**
 * 左键拖动验证：真的移动系统光标，看窗口是否跟手、有没有卡顿残留。
 * 判定：窗口位移 ≈ 光标位移（±4px），且松手后不再继续漂移。
 * 用法：node tools/lab/drag-probe.mjs --port 9222
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
  const on = (e) => {
    const m = JSON.parse(e.data)
    if (m.id !== my) return
    ws.removeEventListener('message', on)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
  ws.addEventListener('message', on)
  ws.send(JSON.stringify({ id: my, method, params }))
})
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const setCursor = (x, y) => execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})`])

// 找一个「模型上但不在热区里」的点：按角色拖窗口只在这类点触发
const pick = await ev(`(() => {
  const box = __probe.regionBox('头')
  for (let y = 40; y < innerHeight - 40; y += 12) {
    for (let x = 20; x < innerWidth - 20; x += 12) {
      if (__probe.hitAt(x, y) === null && __probe.bodyAt(x, y)) {
        const m = __probe.modelAt(x, y)
        if (m) return { x, y }
      }
    }
  }
  return null
})()`)
if (!pick) { console.log('FAIL 找不到非热区的角色点'); ws.close(); process.exit(1) }

const b0 = await ev(`shell.bounds()`)
const sx0 = b0.x + pick.x
const sy0 = b0.y + pick.y
setCursor(sx0, sy0)
await sleep(900)   // 等轮廓掩码刷新（TTL 700ms）：canStart 用的是掩码里的 bodyAt

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pick.x, y: pick.y, button: 'left', buttons: 1, clickCount: 1 })
await sleep(250)
console.log('按下时状态', JSON.stringify(await ev(`__probe.dragState()`)))

// 一次 PowerShell 里分 4 步往右拖 120px：每次 spawn 都有 300ms+ 启动开销，
// 分开发会被「松开」抢在前面，光标根本没来得及动
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.Windows.Forms;
   $sx = ${Math.round(sx0)}; $sy = ${Math.round(sy0)};
   1..4 | ForEach-Object { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(($sx + $_ * 30), $sy); Start-Sleep -Milliseconds 120 }`])
await sleep(350)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pick.x + 120, y: pick.y, button: 'left', buttons: 0, clickCount: 1 })
await sleep(200)
const b1 = await ev(`shell.bounds()`)
await sleep(500)
const b2 = await ev(`shell.bounds()`)

const moved = b1.x - b0.x
const drift = b2.x - b1.x
const ok = Math.abs(moved - 120) <= 6 && Math.abs(drift) <= 1
console.log(`窗口位移 ${moved}px（期望 120）  松手后漂移 ${drift}px  起点 (${pick.x},${pick.y})`)
console.log(ok ? 'PASS' : 'FAIL')
ws.close()
