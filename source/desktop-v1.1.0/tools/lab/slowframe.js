(async () => {
  const r = __probe.refs()
  const t = r.app.ticker
  const rows = []
  let last = performance.now()
  const fn = () => {
    const now = performance.now()
    const m = performance.memory
    rows.push({
      d: +(now - last).toFixed(1),
      heap: m ? Math.round(m.usedJSHeapSize / 1048576) : 0,
      fps: +t.FPS.toFixed(0),
    })
    last = now
  }
  t.add(fn)
  await new Promise((res) => setTimeout(res, 10000))
  t.remove(fn)

  const slowIdx = []
  rows.forEach((r, i) => { if (r.d > 18) slowIdx.push(i) })
  // 只看前 3 处慢帧，输出前后各 6 帧
  const windows = slowIdx.slice(0, 3).map((i) => ({
    at: i,
    before: rows.slice(Math.max(0, i - 6), i).map((x) => x.d),
    hit: rows[i],
    after: rows.slice(i + 1, i + 7).map((x) => x.d),
  }))
  const ds = rows.map((x) => x.d).sort((a, b) => a - b)
  const q = (p) => +ds[Math.floor(ds.length * p)].toFixed(1)
  return {
    frames: rows.length,
    med: q(0.5), p95: q(0.95), p99: q(0.99), max: +ds[ds.length - 1].toFixed(1),
    slowCount: slowIdx.length,
    slowRate: +(slowIdx.length / rows.length * 100).toFixed(1) + '%',
    windows,
    heapStart: rows[0].heap, heapEnd: rows[rows.length - 1].heap,
  }
})()
