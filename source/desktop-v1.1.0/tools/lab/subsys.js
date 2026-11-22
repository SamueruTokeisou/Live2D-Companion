(() => {
  const r = __probe.refs()
  const im = r.im
  const out = {
    breath: !!im.breath,
    breathKeys: im.breath ? Object.keys(im.breath) : null,
    eyeBlink: !!im.eyeBlink,
    motionManager: !!im.motionManager,
    focus: !!im.focusController,
    focusTarget: im.focusController ? { x: im.focusController.x, y: im.focusController.y } : null,
    physics: !!im.physics,
  }
  // 手动推 0.5s 呼吸
  try {
    const before = __probe.read('ParamBreath')
    im.breath?.updateParameters(im.coreModel, 0.5)
    out.breathBefore = before
    out.breathAfter = __probe.read('ParamBreath')
  } catch (e) {
    out.breathErr = e.message
  }
  // 手动推一次焦点
  try {
    const b2 = __probe.read('ParamAngleX')
    im.focusController?.update?.(1 / 60)
    im.updateFocus?.()
    out.focusBefore = b2
    out.focusAfter = __probe.read('ParamAngleX')
  } catch (e) {
    out.focusErr = e.message
  }
  // 参数 id 是怎么识别的
  try {
    out.idAngleX = String(im.idParamAngleX && (im.idParamAngleX.getString ? im.idParamAngleX.getString() : im.idParamAngleX))
  } catch (e) { out.idErr = e.message }
  return out
})()
