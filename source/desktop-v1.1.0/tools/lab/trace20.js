(async () => {
  const deltas = []
  const heap = []
  let last = performance.now()
  const t0 = last
  let nextHeap = t0
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now()
      deltas.push(+(now - last).toFixed(1))
      last = now
      if (now >= nextHeap) {
        nextHeap = now + 1000
        const m = performance.memory
        if (m) heap.push({ t: Math.round(now - t0), used: Math.round(m.usedJSHeapSize / 1048576), total: Math.round(m.totalJSHeapSize / 1048576) })
      }
      if (now - t0 < 20000) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })

  const sorted = [...deltas].sort((a, b) => a - b)
  const q = (p) => sorted[Math.floor(sorted.length * p)]
  // 按秒分桶，看每秒中位帧间隔
  const buckets = []
  let cur = null
  for (const d of deltas) {
    const b = buckets.length
    if (!cur) { cur = { sec: 0, arr: [] }; buckets.push(cur) }
    cur.arr.push(d)
    if (cur.arr.length >= 60) { cur = { sec: b + 1, arr: [] }; if (buckets.length < 22) buckets.push(cur) }
  }
  const perSec = buckets.map((b) => {
    const a = [...b.arr].sort((x, y) => x - y)
    return { med: +a[Math.floor(a.length / 2)].toFixed(1), p90: +a[Math.floor(a.length * 0.9)].toFixed(1), n: a.length }
  })

  return {
    frames: deltas.length,
    fps: +(deltas.length / 20).toFixed(1),
    med: q(0.5), p90: q(0.9), p99: q(0.99), max: sorted[sorted.length - 1],
    over20ms: deltas.filter((d) => d > 20).length,
    perSec,
    heap,
  }
})()
