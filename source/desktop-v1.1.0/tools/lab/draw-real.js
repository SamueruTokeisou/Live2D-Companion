(() => {
  const r = __probe.refs()
  const im = r.im
  const c = document.querySelector('canvas')
  const gl = c.getContext('webgl2')
  const proto = Object.getPrototypeOf(gl)
  if (!proto.__pd) {
    proto.__d = 0
    const o = proto.drawElements
    proto.drawElements = function (...a) { proto.__d += 1; return o.apply(this, a) }
    proto.__pd = true
  }
  proto.__d = 0
  const out = {}
  try {
    im.update(1 / 60)
    im.draw(gl)
    out.drawOk = true
  } catch (e) {
    out.drawErr = e.message
    out.stack = String(e.stack || '').split('\n').slice(0, 5)
  }
  out.drawCalls = proto.__d

  // 看看 pixi 的渲染管线里有没有挂上 Live2D 的 pipe
  const app = r.app
  const pipes = app.renderer?.pipe
  out.pipeKeys = pipes ? Object.getOwnPropertyNames(Object.getPrototypeOf(pipes)).slice(0, 20) : null

  // 手动清屏并画一次，看看画布是否出现像素
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, c.width, c.height)
  out.ctxErr = gl.getError()
  return out
})()
