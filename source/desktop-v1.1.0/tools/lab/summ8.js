(async () => {
  const r = __probe.refs()
  const t = r.app.ticker
  const im = r.im
  const core = im.coreModel._model
  const d = []
  let lastWall = performance.now()
  const origUpdate = core.update.bind(core)
  let u = 0
  core.update = function (...a) {
    const s = performance.now()
    try { return origUpdate(...a) } finally { u = performance.now() - s }
  }
  const origDraw = im.draw.bind(im)
  let rr = 0
  im.draw = function (...a) {
    const s = performance.now()
    try { return origDraw(...a) } finally { rr = performance.now() - s }
  }
  const rows = []
  const fn = () => {
    const now = performance.now()
    rows.push({ d: +(now - lastWall).toFixed(1), u: +u.toFixed(2), r: +rr.toFixed(2) })
    lastWall = now
    u = 0; rr = 0
  }
  t.add(fn)
  await new Promise((res) => setTimeout(res, 8000))
  t.remove(fn)
  core.update = origUpdate
  im.draw = origDraw

  const arr = rows.map((x) => x.d).sort((a, b) => a - b)
  const q = (p) => +arr[Math.floor(arr.length * p)].toFixed(1)
  const us = rows.map((x) => x.u).sort((a, b) => a - b)
  const rs = rows.map((x) => x.r).sort((a, b) => a - b)
  return {
    frames: rows.length,
    fps: +(rows.length / 8).toFixed(1),
    d: { med: q(0.5), p90: q(0.9), p99: q(0.99), max: +arr[arr.length - 1].toFixed(1) },
    slow20: rows.filter((x) => x.d > 20).length,
    slow30: rows.filter((x) => x.d > 30).length,
    work: { updateMed: +us[Math.floor(us.length / 2)].toFixed(2), drawMed: +rs[Math.floor(rs.length / 2)].toFixed(2) },
  }
})()
