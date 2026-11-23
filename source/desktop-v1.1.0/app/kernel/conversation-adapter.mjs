/** Basic conversation presentation. Model-specific keys stay in explicit adapters. */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
export function audioEnergy(samples) {
  if (!samples?.length) return 0
  let sum = 0
  for (const value of samples) if (Number.isFinite(value)) sum += value * value
  return clamp((Math.sqrt(sum / samples.length) - 0.006) / 0.12, 0, 1)
}
export function createConversationAdapter(stage, { mode = 'generic' } = {}) {
  let phase = 'idle', energy = 0, writes = 0, peak = 0
  const saved = new Map()
  const info = id => { try { return stage.param.info(id) } catch { return null } }
  const mouth = info('ParamMouthOpenY')
  function restore() {
    for (const [id, value] of saved) { const p = info(id); if (p) stage.param.set(id, clamp(value, p.min, p.max)) }
    saved.clear()
  }
  const offset = (id, amount) => {
    const p = info(id); if (!p) return
    const base = stage.param.get(id); if (!Number.isFinite(base)) return
    saved.set(id, base); stage.param.set(id, clamp(base + amount * (p.max-p.min), p.min, p.max))
  }
  stage.afterRender(restore)
  stage.onBeforeUpdate(() => {
    if (phase === 'idle') return
    // Restore after drawing so offsets cannot accumulate or alter manual layers.
    restore()
    if (phase === 'thinking') { offset('ParamBrowLY', 0.06); offset('ParamBrowRY', 0.06) }
    else {
      offset('ParamMouthForm', 0.06)
      if (mode === 'deepseek') { offset('MouthSmile_L', 0.08); offset('MouthSmile_R', 0.08) }
    }
    if (phase === 'speaking' && mouth) {
      const base = stage.param.get('ParamMouthOpenY')
      if (Number.isFinite(base)) saved.set('ParamMouthOpenY', base)
      stage.param.set('ParamMouthOpenY', mouth.min + energy * 0.75 * (mouth.max-mouth.min)); writes++
    }
  })
  return {
    setFace(value) { if (!['idle','thinking','responding','speaking'].includes(value)) return; if (value === 'idle') { restore(); energy = 0 } phase = value },
    setAudioLevel(value) { energy = clamp(Number(value) || 0, 0, 1); peak = Math.max(peak, energy) },
    snapshot: () => ({ mode, phase, mouthSupported: !!mouth, mouthWrites: writes, audioLevel: energy, peakAudioLevel: peak }),
    stop() { restore(); phase = 'idle'; energy = 0 },
  }
}
