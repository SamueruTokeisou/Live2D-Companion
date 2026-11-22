(() => {
  const c = document.querySelector('canvas')
  if (!c) return { error: 'no canvas' }
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  const proto = Object.getPrototypeOf(gl)
  if (!proto.__drawCountPatched) {
    proto.__drawCount = 0
    proto.__drawIndexTotals = 0
    const origElements = proto.drawElements
    proto.drawElements = function (...a) {
      proto.__drawCount += 1
      proto.__drawIndexTotals += a[1] || 0
      return origElements.apply(this, a)
    }
    const origArrays = proto.drawArrays
    if (origArrays) {
      proto.drawArrays = function (...a) {
        proto.__drawCount += 1
        return origArrays.apply(this, a)
      }
    }
    proto.__drawCountPatched = true
  }
  proto.__drawCount = 0
  proto.__drawIndexTotals = 0
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        drawCallsIn600ms: proto.__drawCount,
        indexTotals: proto.__drawIndexTotals,
        glError: gl.getError(),
        viewport: Array.from(gl.getParameter(gl.VIEWPORT) || []),
      })
    }, 600)
  })
})()
