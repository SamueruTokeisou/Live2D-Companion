#!/usr/bin/env node
/**
 * 真实鼠标拖动：真按下 + 真移动（SendInput 级），验证事件驱动通路与跟手精度。
 * 依赖 tools/lab/press-drag.ps1。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 9222)
const here = path.dirname(fileURLToPath(import.meta.url))
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
const sx = Math.round(b0.x + pick.x), sy = Math.round(b0.y + pick.y)
const file = path.join(process.env.APPDATA, 'Electron', 'drag-log.json')
const before = existsSync(file) ? statSync(file).mtimeMs : 0

await ev(`__probe.dragLog(true)`)
await ev(`__probe.winSampleStart(4000)`)
// 真实鼠标按下会打到「最上面的窗口」：先置顶，确保打到角色自己
await ev(`shell.set({ alwaysOnTop: true })`)
await sleep(400)
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'press-drag.ps1'),
  '-sx', String(sx), '-sy', String(sy), '-steps', '70', '-stepPx', '3', '-sleepMs', '6'])
await sleep(600)

const rs = await ev(`__probe.dragLog()`)
const win = await ev(`__probe.winSamples()`)
const fresh = existsSync(file) && statSync(file).mtimeMs > before
const ms = fresh ? JSON.parse(readFileSync(file, 'utf8')) : []
const t = ms.filter((x) => x.ev !== 'begin')
const via = {}
for (const x of t) via[x.via] = (via[x.via] || 0) + 1
const dts = []
for (let i = 1; i < t.length; i += 1) dts.push(t[i].t - t[i - 1].t)
dts.sort((a, b) => a - b)
console.log(`主进程 ${t.length} 帧  来源 ${JSON.stringify(via)}  间隔 中位 ${dts[Math.floor(dts.length / 2)] || '-'}ms p90 ${dts[Math.floor(dts.length * 0.9)] || '-'}ms max ${dts[dts.length - 1] || '-'}ms`)
const bad = t.filter((x) => Math.abs(x.ax - x.tx) > 1 || Math.abs(x.ay - x.ty) > 1)
console.log(`目标≠实际 ${bad.length} 帧`)
const totalCursor = t.length ? t[t.length - 1].cx - t[0].cx : 0
const totalWin = t.length ? t[t.length - 1].ax - t[0].ax : 0
console.log(`总位移 光标 ${totalCursor}px 窗口 ${totalWin}px 差 ${totalCursor - totalWin}px`)
const rsMoves = rs.filter((x) => x.ev !== 'down')
if (rsMoves.length) {
  const rd = []
  for (let i = 1; i < rsMoves.length; i += 1) rd.push(rsMoves[i].t - rsMoves[i - 1].t)
  rd.sort((a, b) => a - b)
  console.log(`渲染层 pointermove ${rsMoves.length} 次  间隔 中位 ${rd[Math.floor(rd.length / 2)]}ms`)
} else {
  console.log('渲染层 pointermove 0 次')
}
const changes = []
let prev = win[0]
for (const s of win.slice(1)) if (s.x !== prev.x) { changes.push(s.t - prev.t); prev = s }
if (changes.length) {
  changes.sort((a, b) => a - b)
  console.log(`窗口位置变化 ${changes.length} 次  间隔 中位 ${changes[Math.floor(changes.length / 2)]}ms`)
}
ws.close()
