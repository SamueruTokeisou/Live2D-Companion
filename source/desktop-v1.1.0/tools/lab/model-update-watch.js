(async () => {
  const r = __probe.refs()
  const m = r.model
  const im = m.internalModel
  let updateCalls = 0
  let imUpdateCalls = 0
  const errs = []
  const origModelUpdate = m.update.bind(m)
  m.update = function (...a) {
    updateCalls++
    try { return origModelUpdate(...a) } catch (e) { errs.push('model.update: ' + e.message); throw e }
  }
  const origImUpdate = im.update.bind(im)
  im.update = function (...a) {
    imUpdateCalls++
    try { return origImUpdate(...a) } catch (e) { errs.push('im.update: ' + e.message); throw e }
  }
  await new Promise((res) => setTimeout(res, 800))
  return {
    updateCalls,
    imUpdateCalls,
    errs: errs.slice(0, 3),
    autoUpdate: m.autoUpdate,
    angleX: __probe.read('ParamAngleX'),
    breath: __probe.read('ParamBreath'),
  }
})()
