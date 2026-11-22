(() => {
  const r = __probe.refs()
  const im = r.im
  const c = document.querySelector('canvas')
  const gl = c.getContext('webgl2')
  const core = im.coreModel
  const raw = core._model || core

  const snaps = []
  const orig = im.draw.bind(im)
  im.draw = function (g) {
    snaps.push({
      flags: Array.from(raw.drawables.dynamicFlags.slice(0, 6)),
      opacities: Array.from(raw.drawables.opacities.slice(0, 3)),
      orders: Array.from(raw.drawables.renderOrders.slice(0, 6)),
      pos0: Array.from(raw.drawables.vertexPositions[0].slice(0, 4)),
      vcount0: raw.drawables.vertexCounts[0],
      icount0: raw.drawables.indexCounts[0],
      orderGetter: (() => { try { return Array.from(core.getDrawableRenderOrders?.() || []).slice(0, 6) } catch (e) { return 'ERR:' + e.message } })(),
    })
    return orig(g)
  }
  try { im.update(1 / 60) } catch (e) { snaps.push({ updateErr: e.message }) }
  const proto = Object.getPrototypeOf(gl)
  if (!proto.__pd2) {
    proto.__d = 0
    const o = proto.drawElements
    proto.drawElements = function (...a) { proto.__d += 1; return o.apply(this, a) }
    proto.__pd2 = true
  }
  proto.__d = 0
  try { im.draw(gl) } catch (e) { snaps.push({ drawErr: e.message }) }
  const draws = proto.__d
  im.draw = orig
  return { snaps, draws, size: core.getDrawableCount?.() }
})()
