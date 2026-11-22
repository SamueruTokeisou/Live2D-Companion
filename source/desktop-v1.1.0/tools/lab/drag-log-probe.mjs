#!/usr/bin/env node
/**
 * 拖动数据记录：真移光标拖一段，分别拿
 *   渲染层采样（pointermove 的 dx/dy 与到达时间）
 *   主进程采样（STAGE_DRAG_LOG=1 时每 16ms 一帧：光标 / 目标 / 实际位置）
 * 然后统计「卡」的形态：时间间隔尖峰、目标与实际不一致（setPosition 没生效）、丢帧导致的跳跃。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

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
const cursor = (expr) => execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${expr.replace('$X', '$p.X').replace('$Y', '$p.Y')})`])

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
const sx0 = b0.x + pick.x, sy0 = b0.y + pick.y

await ev(`__probe.dragLog(true)`)
cursor(`${Math.round(sx0)},${Math.round(sy0)}`)
await sleep(400)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pick.x, y: pick.y, button: 'left', buttons: 1, clickCount: 1 })
await sleep(200)
console.log('按下状态', JSON.stringify(await ev(`__probe.dragState()`)))
await ev(`__probe.winSampleStart(2600)`)
// 一次 PowerShell 里做 24 步、每步 15px、间隔 45ms：约 360px / 1.1 秒，接近真实拖动速度
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.Windows.Forms;
   $sx=${Math.round(sx0)}; $sy=${Math.round(sy0)};
   1..24 | ForEach-Object { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(($sx + $_ * 15), $sy); Start-Sleep -Milliseconds 45 }`])
await sleep(300)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pick.x + 360, y: pick.y, button: 'left', buttons: 0, clickCount: 1 })
await sleep(600)
const win = await ev(`__probe.winSamples()`)
// 窗口实际位置：统计「位置变化」的节奏
const changes = []
let prev = win[0]
for (const s of win.slice(1)) {
  if (s.x !== prev.x || s.y !== prev.y) { changes.push({ t: s.t, dt: s.t - prev.t, d: Math.abs(s.x - prev.x) }); prev = s }
}
if (changes.length) {
  const dts = changes.map((c) => c.dt).sort((a, b) => a - b)
  const steps = changes.map((c) => c.d)
  console.log(`窗口位置：${changes.length} 次变化 / ${win.length} 帧（rAF）  变化间隔 中位 ${dts[Math.floor(dts.length / 2)]}ms 最大 ${dts[dts.length - 1]}ms  单次步长 中位 ${steps.sort((a, b) => a - b)[Math.floor(steps.length / 2)]}px`)
} else {
  console.log('窗口位置：整段没变化（拖动没生效？）')
}

const rs = await ev(`__probe.dragLog()`)
const file = path.join(process.env.APPDATA, 'Electron', 'drag-log.json')
const ms = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []

function stats(list, label, key) {
  if (!list.length) { console.log(label, '无数据'); return }
  const dts = []
  for (let i = 1; i < list.length; i += 1) dts.push(list[i][key] - list[i - 1][key])
  dts.sort((a, b) => a - b)
  const med = dts[Math.floor(dts.length / 2)]
  const max = dts[dts.length - 1]
  const slow = dts.filter((d) => d > 40).length
  console.log(`${label} 样本 ${list.length}  间隔 中位 ${med}ms 最大 ${max}ms  >40ms 的 ${slow} 次`)
}
stats(rs.filter((x) => x.ev !== 'down'), '渲染层', 't')
stats(ms.filter((x) => x.ev !== 'begin'), '主进程', 't')

const bad = ms.filter((x) => Math.abs(x.ax - x.tx) > 1 || Math.abs(x.ay - x.ty) > 1)
console.log(`主进程：目标与实际不一致 ${bad.length} / ${ms.length - 1} 帧`)
if (bad.length) console.log('  例：', JSON.stringify(bad.slice(0, 3)))
// 光标两次采样没动 = 定时器空转；一次跳很多 = 掉帧
const moves = ms.filter((x) => x.ev !== 'begin').map((x) => ({ dx: x.cx, dy: x.cy }))
const stalls = []
for (let i = 1; i < moves.length; i += 1) if (moves[i].dx === moves[i - 1].dx) stalls.push(i)
console.log(`主进程：光标未变化（空转帧）${stalls.length} 次`)
const last = ms[ms.length - 1]
const first = ms[0]
if (last && first) console.log(`总位移：光标 ${last.cx - first.cx}px，窗口 ${last.ax - first.ax}px（差值=跟手误差）`)
ws.close()
