(() => {
  const r = __probe.refs()
  const st = r.stage
  const out = {}
  out.paramKeys = Object.keys(st.param || {})
  try {
    out.before = st.param.get('ParamAngleX')
    st.param.set('ParamAngleX', 20)
    out.afterSet = st.param.get('ParamAngleX')
    st.advance(16)
    out.afterAdvance = st.param.get('ParamAngleX')
    out.readProbe = __probe.read('ParamAngleX')
  } catch (e) {
    out.err = e.message + ' | ' + String(e.stack || '').split('\n')[1]
  }
  // 直接看 core model 的原生对象
  const cm = r.im.coreModel
  out.cmType = cm?.constructor?.name
  out.hasRaw = !!cm?._model
  if (cm?._model) {
    const raw = cm._model
    const i = raw.getParameterIndex ? raw.getParameterIndex('ParamAngleX') : -1
    out.rawIndex = i
    out.rawValue = i >= 0 ? raw.parameters.values[i] : null
  }
  return out
})()
