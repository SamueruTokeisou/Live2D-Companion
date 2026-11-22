(() => {
  const r = __probe.refs()
  const st = r.stage
  const out = { hasStep: typeof st.step, hasAdvance: typeof st.advance, hasRenderOnce: typeof st.renderOnce }
  try { out.clocks = st.clocks ? st.clocks() : null } catch (e) { out.clocksErr = e.message }

  if (typeof st.advance === 'function') {
    try {
      st.advance(1 / 60)
      out.advanceOk = true
    } catch (e) {
      out.advanceErr = { message: e.message, stack: String(e.stack || '').split('\n').slice(0, 6) }
    }
  }
  if (typeof st.step === 'function') {
    try {
      st.step(1 / 60)
      out.stepOk = true
    } catch (e) {
      out.stepErr = { message: e.message, stack: String(e.stack || '').split('\n').slice(0, 6) }
    }
  }
  // 参数有没有被推进
  out.angleX = __probe.read('ParamAngleX')
  out.breath = __probe.read('ParamBreath')
  return out
})()
