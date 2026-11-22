#!/usr/bin/env node
/**
 * 气泡自动隐藏竞态：在页面里用独立 DOM 实例化一个 bubble，
 * say(带 600ms 自动隐藏) 后立刻换成新话，等过点后应该仍然可见。
 */
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}

const out = await ev(`(async () => {
  const { createBubble } = await import('/src/stage/bubble.js')
  const el = document.createElement('div')
  el.style.position = 'fixed'; el.style.left = '20px'; el.style.top = '20px'
  document.body.append(el)
  const b = createBubble({ el, anchor: () => ({ left: 100, top: 100, right: 200 }) })
  b.say('head', { ms: 600 })
  b.show('新的一句，不该被旧定时器收掉')
  await new Promise((r) => setTimeout(r, 900))
  const st = b.state()
  el.remove()
  return st
})()`)
console.log('结果', JSON.stringify(out))
console.log(out.visible && out.text === '新的一句，不该被旧定时器收掉' ? 'PASS' : 'FAIL')
ws.close()
