(() => {
  const out = {}
  const r = __probe.refs()
  const m = r.model, im = r.im, app = r.app
  out.modelRenderType = typeof m.render
  out.imDrawType = typeof im.draw
  out.rendererClass = im.renderer?.constructor?.name
  out.rendererGl = !!im.renderer?.gl

  const c = document.querySelector('canvas')
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  const proto = Object.getPrototypeOf(gl)
  if (!proto.__patched2) {
    proto.__draws = 0
    const o1 = proto.drawElements
    proto.drawElements = function (...a) { proto.__draws += 1; return o1.apply(this, a) }
    proto.__patched2 = true
  }

  // 1) 直接调内部模型的 draw
  proto.__draws = 0
  try {
    im.draw(app.renderer)
    out.imDrawOk = true
  } catch (e) { out.imDrawErr = e.message + ' | ' + (e.stack || '').split('\n')[1] }
  out.imDrawCalls = proto.__draws

  // 2) 走 pixi 的 model.render
  proto.__draws = 0
  try {
    m.render(app.renderer)
    out.modelRenderOk = true
  } catch (e) { out.modelRenderErr = e.message + ' | ' + (e.stack || '').split('\n')[1] }
  out.modelRenderCalls = proto.__draws

  // 3) 关键量
  const core = im.coreModel?._model || im.coreModel
  const d = core?.drawables
  if (d) {
    out.count = d.count
    out.vertexCounts0 = d.vertexCounts?.[0]
    out.indexCounts0 = d.indexCounts?.[0]
    out.pos0 = d.vertexPositions?.[0] ? Array.from(d.vertexPositions[0].slice(0, 4)) : null
    out.opacities0 = d.opacities ? Array.from(d.opacities.slice(0, 4)) : null
    out.flags0 = d.dynamicFlags ? Array.from(d.dynamicFlags.slice(0, 4)) : null
    out.multiply0 = d.multiplyColors ? Array.from(d.multiplyColors.slice(0, 4)) : null
    out.textureIndices0 = d.textureIndices ? Array.from(d.textureIndices.slice(0, 4)) : null
    out.renderOrders0 = d.renderOrders ? Array.from(d.renderOrders.slice(0, 4)) : null
  }
  out.textures = im.textures ? im.textures.length : String(im.textures)
  out.masks = im.masks ? im.masks.length : String(im.masks)
  return out
})()
