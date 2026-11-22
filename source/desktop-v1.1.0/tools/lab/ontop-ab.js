(async () => {
  const sample = async (ms) => {
    const d = []
    let last = performance.now()
    const t0 = last
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now()
        d.push(now - last)
        last = now
        if (now - t0 < ms) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    d.sort((a, b) => a - b)
    return {
      frames: d.length,
      fps: +(d.length / (ms / 1000)).toFixed(1),
      med: +d[Math.floor(d.length / 2)].toFixed(1),
      p90: +d[Math.floor(d.length * 0.9)].toFixed(1),
      max: +d[d.length - 1].toFixed(1),
    }
  }

  await window.shell.set({ alwaysOnTop: true })
  window.focus()
  await new Promise((r) => setTimeout(r, 600))
  const onTop = await sample(3000)

  await window.shell.set({ alwaysOnTop: false })
  await new Promise((r) => setTimeout(r, 600))
  const normal = await sample(3000)

  return { onTop, normal, focus: document.hasFocus(), vis: document.visibilityState }
})()
