(() => {
  const c = document.querySelector('canvas')
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  const proto = Object.getPrototypeOf(gl)
  if (!proto.__patched) {
    proto.__draws = 0
    proto.__idx = 0
    proto.__progs = new Set()
    const o1 = proto.drawElements
    proto.drawElements = function (...a) { proto.__draws += 1; proto.__idx += a[1] || 0; return o1.apply(this, a) }
    const o2 = proto.drawArrays
    proto.drawArrays = function (...a) { proto.__draws += 1; return o2.apply(this, a) }
    const o3 = proto.uniformMatrix4fv
    proto.uniformMatrix4fv = function (loc, t, v) { proto.__progs.add(t); return o3.apply(this, loc, t, v) }
    proto.__patched = true
  }
  proto.__draws = 0
  proto.__idx = 0
  const frames = []
  for (let i = 0; i < 3; i++) frames.push(__probe.frameOnce())
  const after = { draws: proto.__draws, indices: proto.__idx, frames }
  // 再等一会儿，看 ticker 自己有没有画
  return new Promise((resolve) => {
    const base = proto.__draws
    setTimeout(() => {
      resolve({
        manualFrames: after,
        autoDrawsIn800ms: proto.__draws - base,
        tickerCount: __probe.debugStage().ticker,
      })
    }, 800)
  })
})()
