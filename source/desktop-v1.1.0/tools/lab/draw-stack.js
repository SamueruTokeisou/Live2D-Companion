(() => {
  const r = __probe.refs()
  const im = r.im, app = r.app
  const out = {}
  out.sameGl = im.renderer.gl === app.renderer.gl
  out.imGlCtor = im.renderer.gl?.constructor?.name
  out.appGlCtor = app.renderer.gl?.constructor?.name
  out.imGlIsContext = typeof im.renderer.gl?.getParameter
  // 手动走一遍内部模型 draw，抓完整堆栈
  try {
    im.update(1 / 60)
    im.draw(app.renderer)
    out.drawOk = true
  } catch (e) {
    out.drawErr = e.message
    out.stack = String(e.stack || '').split('\n').slice(0, 6)
  }
  return out
})()
