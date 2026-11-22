(async () => {
  const r = __probe.refs()
  const t = r.app.ticker
  const im = r.im
  const core = im.coreModel._model
  const rec = []

  const origUpdate = core.update.bind(core)
  let lastUpdateMs = 0
  core.update = function (...a) {
    const s = performance.now()
    try { return origUpdate(...a) } finally { lastUpdateMs = performance.now() - s }
  }
  const origDraw = im.draw.bind(im)
  let lastDrawMs = 0
  im.draw = function (...a) {
    const s = performance.now()
    try { return origDraw(...a) } finally { lastDrawMs = performance.now() - s }
  }

  let lastWall = performance.now()
  const fn = () => {
    const now = performance.now()
    rec.push({ d: +(now - lastWall).toFixed(1), u: +lastUpdateMs.toFixed(2), r: +lastDrawMs.toFixed(2) })
    lastWall = now
    lastUpdateMs = 0
    lastDrawMs = 0
  }
  t.add(fn)
  const t0 = performance.now()
  await new Promise((res) => setTimeout(res, 12000))
  t.remove(fn)
  core.update = origUpdate
  im.draw = origDraw

  const slow = rec.filter((x) => x.d > 20).sort((a, b) => b.d - a.d).slice(0, 12)
  const upd = rec.map((x) => x.u).sort((a, b) => a - b)
  const drw = rec.map((x) => x.r).sort((a, b) => a - b)
  const q = (arr, p) => +arr[Math.floor(arr.length * p)].toFixed(2)
  return {
    seconds: +((performance.now() - t0) / 1000).toFixed(1),
    frames: rec.length,
    d_ms: { med: q(rec.map((x) => x.d).sort((a, b) => a - b), 0.5), p90: q(rec.map((x) => x.d).sort((a, b) => a - b), 0.9), p99: q(rec.map((x) => x.d).sort((a, b) => a - b), 0.99) },
    coreUpdate: { med: q(upd, 0.5), p90: q(upd, 0.9), max: +upd[upd.length - 1].toFixed(2) },
    draw: { med: q(drw, 0.5), p90: q(drw, 0.9), max: +drw[drw.length - 1].toFixed(2) },
    slowFrames: slow,
  }
})()
