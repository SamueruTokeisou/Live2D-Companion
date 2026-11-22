(async () => {
  const r = __probe.refs()
  const im = r.im
  const calls = []
  const orig = im.update.bind(im)
  im.update = function (...a) {
    if (calls.length < 6) calls.push(a.map((v) => (typeof v === 'number' ? +v.toFixed(3) : String(v))))
    return orig(...a)
  }
  const before = {
    angleX: __probe.read('ParamAngleX'),
    breath: __probe.read('ParamBreath'),
    eyeL: __probe.read('ParamEyeLOpen'),
  }
  await new Promise((res) => setTimeout(res, 1000))
  im.update = orig
  return {
    calls,
    before,
    after: {
      angleX: __probe.read('ParamAngleX'),
      breath: __probe.read('ParamBreath'),
      eyeL: __probe.read('ParamEyeLOpen'),
    },
  }
})()
