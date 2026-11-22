#!/usr/bin/env node
/**
 * 帧节奏诊断：窗口真实出帧间隔 vs 显示刷新周期。
 *
 * 判据（来自华为 NekoBuddy 的「对齐刷新网格」经验）：
 *   帧间隔应当是刷新周期 P 的整数倍。P = 1000/240 ≈ 4.167ms。
 *   - 落在 4.0 / 4.25 这种非整数倍上 → 帧耗时卡在 deadline，系统在替我们决定跳哪帧
 *   - 落在 1.00 / 2.00 / 3.00 → 节奏对齐，观感光滑
 *
 * 同时记 rAF 与 PIXI ticker 两条时间线，判断是不是同一条（ticker 由 rAF 驱动）。
 */
const port = Number(process.argv[2] || 9222)
// 可选：采样前给 ticker 设帧率上限（0 = 不设），用于对比「加限帧」是否让节奏更差
const capArg = process.argv[3] !== undefined ? Number(process.argv[3]) : null
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
const page = list.find((x) => x.type === 'page' && /app\//.test(x.url))
if (!page) throw new Error('找不到页面')
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}

const HAS = `(() => {
  const { app } = __probe.refs()
  return { app: !!app, ticker: !!app?.ticker, P: window.devicePixelRatio, w: innerWidth, h: innerHeight,
    vis: document.visibilityState, focus: document.hasFocus(), screen: [screen.width, screen.height] }
})()`

const SAMPLE = (ms) => `(async () => {
  const P = 1000 / 240
  const { app } = __probe.refs()
  const ticker = app.ticker
  const tk = [], raf = []
  const onTick = () => tk.push(performance.now())
  ticker.add(onTick)
  let stop = false
  const step = () => { raf.push(performance.now()); if (!stop) requestAnimationFrame(step) }
  requestAnimationFrame(step)
  await new Promise((r) => setTimeout(r, ${ms}))
  stop = true
  ticker.remove(onTick)

  const d = (a) => { const o = []; for (let i = 1; i < a.length; i += 1) o.push(a[i] - a[i - 1]); return o }
  const stat = (a) => {
    if (!a.length) return null
    const s = [...a].sort((x, y) => x - y)
    const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2)
    return { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), min: q(0), p10: q(0.1), med: q(0.5), p90: q(0.9), max: q(1) }
  }
  const top = (a, n = 6) => { const m = new Map(); for (const v of a) { const k = Math.round(v * 2) / 2; m.set(k, (m.get(k) || 0) + 1) }
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([v, c]) => [+v.toFixed(1), c]) }
  // 折算成「几个刷新周期」
  const grid = (a) => { const m = new Map(); for (const v of a) { const k = Math.round((v / P) * 4) / 4; m.set(k, (m.get(k) || 0) + 1) }
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([v, c]) => [+v.toFixed(2), c]) }

  const dt = d(tk), dr = d(raf)
  return {
    tickFPS: +ticker.FPS.toFixed(2), maxFPS: ticker.maxFPS, started: ticker.started, deltaMS: +ticker.deltaMS.toFixed(2),
    tick: stat(dt), raf: stat(dr),
    // 前 24 帧各占几个刷新周期：连成串就能看出「节拍」是不是均匀（3,3,4,3,3,4… 就是拍频）
    seq: dt.slice(0, 24).map((v) => +(v / P).toFixed(2)),
    tickTop: top(dt), rafTop: top(dr),
    tickGrid: grid(dt), rafGrid: grid(dr),
  }
})()`

console.log('环境', JSON.stringify(await ev(HAS)))
await ev(`shell.set({ alwaysOnTop: true }); window.focus(); 1`)
// 注意：shell.set 会广播设置并把 ticker.maxFPS 重置回 settings.fps，所以要等它落地之后再设上限
await new Promise((r) => setTimeout(r, 1200))
if (capArg !== null) {
  const back = await ev(`(() => { const t = __probe.refs().app.ticker; t.maxFPS = ${capArg}; return t.maxFPS })()`)
  console.log(`（已设 ticker.maxFPS = ${capArg}，读回 ${back}）`)
}
await new Promise((r) => setTimeout(r, 500))
console.log('\n=== 静置 3s ===')
console.log(JSON.stringify(await ev(SAMPLE(3000)), null, 1))
console.log('\n=== 鼠标活动 2.5s ===')
await ev(`(() => {
  window.__mv = setInterval(() => {
    const x = 60 + Math.random() * 400, y = 60 + Math.random() * 600
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, screenX: window.screenX + x, screenY: window.screenY + y, bubbles: true }))
  }, 16)
  return true
})()`)
console.log(JSON.stringify(await ev(SAMPLE(2500)), null, 1))
await ev(`clearInterval(window.__mv); 1`)
if (capArg !== null) {
  const back = await ev(`(() => { const t = __probe.refs().app.ticker; t.maxFPS = 0; return t.maxFPS })()`)
  console.log(`\n（已还原 ticker.maxFPS = ${back}）`)
}
ws.close()
