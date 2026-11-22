(async () => {
  const ids = ['ParamAngleX', 'ParamAngleY', 'ParamBreath', 'ParamEyeLOpen', 'ParamBodyAngleX']
  const snap = () => {
    const o = {}
    for (const id of ids) o[id] = typeof __probe.read === 'function' ? +Number(__probe.read(id)).toFixed(4) : null
    o.ticker = __probe.debugStage().ticker
    return o
  }
  const out = [snap()]
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 250))
    out.push(snap())
  }
  return out
})()
