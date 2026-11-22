(async () => {
  const r = __probe.refs()
  const cm = r.im.coreModel
  const raw = cm._model
  const hash = () => {
    const p = raw.drawables.vertexPositions
    let s = 0
    for (let i = 0; i < 6; i++) {
      const a = p[i]
      for (let k = 0; k < a.length; k += 7) s += a[k] * (k + 1)
    }
    return +s.toFixed(6)
  }
  const samples = []
  for (let i = 0; i < 5; i++) {
    samples.push(hash())
    await new Promise((res) => setTimeout(res, 200))
  }
  return {
    samples,
    changed: new Set(samples).size > 1,
    // 同时看 eyeBlink 的当前相位，判断它是否在走
    blinkPhase: r.im.eyeBlink?._blinking ? 'blinking' : 'idle',
    breathTime: +Number(r.im.breath?._currentTime || 0).toFixed(3),
  }
})()
