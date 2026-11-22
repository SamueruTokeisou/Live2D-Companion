#!/usr/bin/env node
/** 拖动诊断：pointerdown 有没有到？canStart 是否被热区状态挡住？光标真的动了吗？ */
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

const bounds = await ev(`shell.bounds()`)
console.log('bounds', JSON.stringify(bounds))
// 光标位置读写
const cur = execFileSync('powershell.exe', ['-NoProfile', '-Command',
  'Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; "$($p.X),$($p.Y)"']).toString().trim()
console.log('cursor now', cur)

await ev(`window.__dbg = []; ['pointerdown','pointermove','pointerup'].forEach(t => window.addEventListener(t, e => __dbg.push([t, e.button, e.buttons, e.isTrusted]), true))`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 300, button: 'none', buttons: 0 })
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 300, button: 'left', buttons: 1, clickCount: 1 })
await sleep(150)
const dbg = await ev(`__dbg`)
console.log('events', JSON.stringify(dbg))
const pressed = await ev(`(() => { try { return JSON.stringify(__probe.pressed ?? null) } catch { return 'no' } })()`)
console.log('probe.pressed', pressed)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 300, button: 'left', buttons: 0, clickCount: 1 })
ws.close()
