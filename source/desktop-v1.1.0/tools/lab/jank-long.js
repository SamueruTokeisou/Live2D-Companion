(async () => {
  const deltas = []
  const costs = []
  const states = []
  let last = performance.now()
  const t0 = last
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now()
      const d = now - last
      last = now
      if (d > 0) deltas.push(+d.toFixed(1))
      // 每 5 帧量一次纯帧成本
      if (deltas.length % 5 === 0) {
        const c = __probe.frameOnce(1 / 60)
        if (typeof c === 'number') costs.push(c)
      }
      states.push({
        t: +(now - t0).toFixed(0),
        vis: document.visibilityState,
        focus: document.hasFocus(),
        d: +d.toFixed(1),
      })
      if (now - t0 < 12000) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })

  const sorted = [...deltas].sort((a, b) => a - b)
  const q = (p) => sorted[Math.floor(sorted.length * p)]
  const outliers = states.filter((s) => s.d > 40).slice(0, 20)
  const focusChanges = []
  let prev = null
  for (const s of states) {
    const key = s.vis + '|' + s.focus
    if (key !== prev) { focusChanges.push({ t: s.t, vis: s.vis, focus: s.focus }); prev = key }
  }
  return {
    frames: deltas.length,
    median: q(0.5),
    p90: q(0.9),
    p99: q(0.99),
    max: sorted[sorted.length - 1],
    slowFrames: deltas.filter((d) => d > 30).length,
    worst20: outliers,
    focusChanges,
    costMed: costs.length ? [...costs].sort((a, b) => a - b)[Math.floor(costs.length / 2)] : null,
    costMax: costs.length ? Math.max(...costs) : null,
  }
})()
