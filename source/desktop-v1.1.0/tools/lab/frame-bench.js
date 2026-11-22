(() => {
  const samples = []
  for (let i = 0; i < 50; i++) {
    const t = __probe.frameOnce(1 / 60)
    if (t != null) samples.push(t)
  }
  samples.sort((a, b) => a - b)
  const pick = (p) => samples[Math.floor(samples.length * p)]
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length
  return {
    n: samples.length,
    med: +pick(0.5).toFixed(2),
    p10: +pick(0.1).toFixed(2),
    p90: +pick(0.9).toFixed(2),
    avg: +avg.toFixed(2),
    min: +samples[0].toFixed(2),
    max: +samples[samples.length - 1].toFixed(2),
  }
})()
