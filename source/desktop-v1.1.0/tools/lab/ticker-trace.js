(async () => {
  const r = __probe.refs()
  const t = r.app.ticker
  const deltas = []
  const wall = []
  let lastWall = performance.now()
  const fn = () => {
    deltas.push(+t.deltaMS.toFixed(2))
    const now = performance.now()
    wall.push(+(now - lastWall).toFixed(1))
    lastWall = now
  }
  t.add(fn)
  const t0 = performance.now()
  await new Promise((res) => setTimeout(res, 15000))
  t.remove(fn)
  const secs = (performance.now() - t0) / 1000

  const summarize = (arr) => {
    const s = [...arr].sort((a, b) => a - b)
    const q = (p) => +s[Math.floor(s.length * p)].toFixed(1)
    return { n: s.length, med: q(0.5), p90: q(0.9), p99: q(0.99), max: +s[s.length - 1].toFixed(1), over20: arr.filter((x) => x > 20).length, over33: arr.filter((x) => x > 33).length }
  }
  // 每秒一段，看是否忽快忽慢
  const perSec = []
  for (let i = 0; i < deltas.length; i += Math.max(1, Math.round(deltas.length / secs / 2))) {
    const seg = deltas.slice(i, i + 60)
    if (seg.length) perSec.push(+(seg.reduce((a, b) => a + b, 0) / seg.length).toFixed(1))
  }
  return { seconds: +secs.toFixed(1), tickerFps: +(deltas.length / secs).toFixed(1), delta: summarize(deltas), wallClock: summarize(wall), perSecAvgDelta: perSec.slice(0, 20) }
})()
