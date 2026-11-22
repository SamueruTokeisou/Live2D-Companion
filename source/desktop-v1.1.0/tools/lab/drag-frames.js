(async () => {
  const r = __probe.refs()
  const t = r.app.ticker
  const deltas = []
  const fn = () => deltas.push(+t.deltaMS.toFixed(2))
  t.add(fn)

  const sample = async (ms) => {
    const s = deltas.length
    await new Promise((res) => setTimeout(res, ms))
    return deltas.slice(s)
  }
  const sum = (arr) => {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    return {
      n: s.length,
      med: +s[Math.floor(s.length / 2)].toFixed(1),
      p90: +s[Math.floor(s.length * 0.9)].toFixed(1),
      max: +s[s.length - 1].toFixed(1),
      fps: +(1000 / (arr.reduce((a, b) => a + b, 0) / arr.length)).toFixed(0),
    }
  }

  const idle = await sample(2000)

  // 合成拖动：每 8ms 一次 +6px，共 80 次
  const b = await window.shell.bounds()
  const sx = b.x + b.width / 2
  const sy = b.y + 40
  window.shell.dragBegin(sx, sy)
  const t0 = performance.now()
  for (let i = 1; i <= 80; i++) {
    window.shell.dragMove(sx + i * 6, sy + i * 2)
    await new Promise((res) => setTimeout(res, 8))
  }
  const dragMs = performance.now() - t0
  window.shell.dragEnd()
  await new Promise((res) => setTimeout(res, 100))
  const b1 = await window.shell.bounds()

  t.remove(fn)
  return {
    idle: sum(idle),
    dragMs: Math.round(dragMs),
    drag: sum(deltas.slice(idle.length)),
    moved: { dx: b1.x - b.x, dy: b1.y - b.y },
    expected: { dx: 80 * 6, dy: 80 * 2 },
  }
})()
