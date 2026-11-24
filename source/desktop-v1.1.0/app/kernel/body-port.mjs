import { audioEnergy } from './conversation-adapter.mjs'
/** A body owns its own rendering; no model parameter IDs enter the kernel. */
export class BodySession {
  constructor({ showText, clearText, playAudio = null, stopAudio = () => {}, setFace = () => {}, capabilities = ['text', 'stop'] }) {
    this.showText = showText; this.clearText = clearText; this.setFace = setFace; this.playAudio = playAudio; this.stopAudio = stopAudio; this.capabilities = capabilities
    this.generation = 0; this.taskId = null; this.closed = true; this.seen = new Set()
  }
  begin({ taskId, generation }) {
    if (typeof taskId !== 'string' || !Number.isSafeInteger(generation) || generation <= this.generation) return { status: 'cancelled', taskId }
    this.stopAudio(); this.clearText(); this.generation = generation; this.taskId = taskId; this.closed = false; this.seen.clear(); this.setFace('thinking')
    return { status: 'accepted', taskId }
  }
  execute(command) {
    const { taskId, generation, commandId, kind, payload } = command ?? {}
    const receipt = status => ({ status, taskId, commandId })
    if (this.closed || generation !== this.generation || taskId !== this.taskId) return receipt('cancelled')
    if (typeof commandId !== 'string' || this.seen.has(commandId)) return receipt('cancelled')
    if (!this.capabilities.includes(kind)) return receipt('unsupported')
    if (kind === 'stop') { this.seen.add(commandId); const stopped = this.stop({ taskId, generation }); return receipt(stopped.status) }
    if (kind === 'audio-stop') { this.stopAudio(); this.seen.add(commandId); return receipt('completed') }
    if (kind === 'audio') {
      if (!this.playAudio || typeof payload?.wav !== 'string' || payload.wav.length > 12 * 2**20 || !Number.isFinite(payload.volume) || payload.volume < 0 || payload.volume > 1) return receipt('failed')
      this.seen.add(commandId)
      return Promise.resolve().then(() => {
        if (this.closed || generation !== this.generation || taskId !== this.taskId) return receipt('cancelled')
        return this.playAudio(payload.wav, payload.volume, () => !this.closed && generation === this.generation && taskId === this.taskId).then(() => receipt(this.closed || generation !== this.generation ? 'cancelled' : 'completed'))
      }).catch(() => receipt('failed'))
    }
    if (kind === 'text') {
      if (typeof payload?.text !== 'string' || !payload.text.trim() || payload.text.length > 600 || !Number.isFinite(payload.durationMs) || payload.durationMs < 100 || payload.durationMs > 10000) return receipt('failed')
      this.seen.add(commandId)
      this.setFace('responding')
      this.showText(payload.text, payload.durationMs, taskId)
      return receipt('completed')  // Text display applied; task controls its display lifetime.
    }
    return receipt('unsupported')
  }
  stop({ taskId, generation }) {
    if (generation < this.generation || (generation === this.generation && this.taskId !== null && taskId !== this.taskId)) return { status: 'cancelled', taskId }
    if (!Number.isSafeInteger(generation)) return { status: 'failed', taskId }
    this.generation = generation; this.taskId = taskId; this.closed = true; this.stopAudio(); this.clearText(); this.setFace('idle')
    return { status: 'completed', taskId }
  }
}

/** Separate overlay: stopping a kernel task never clears manual clothes/expressions. */
export function installBodyPort(shell = window.shell, presentation = null) {
  let overlay = null, timer = null, audio = null, audioUrl = null, audioState = 'idle', audioEpoch = 0
  let playbackTiming = null, audioWarmupMs = null
  let context = null, analyser = null, source = null, animation = null, smoothed = 0, bubbles = true
  const prepareAudio = () => {
    if (!presentation || context) return
    const started = performance.now()
    context = new AudioContext()
    audioWarmupMs = +(performance.now()-started).toFixed(1)
    context.resume().catch(() => {})
  }
  Promise.resolve(shell?.get?.()).then(s => { bubbles = s?.bubble !== false; if (s?.voiceEnabled) prepareAudio() }).catch(() => {})
  shell?.onSettings?.(s => { bubbles = s.bubble !== false; if (s.voiceEnabled) { try { prepareAudio() } catch {} }; if (!bubbles) { clearText(); if (!['playing', 'starting'].includes(audioState)) presentation?.setFace('idle') } })
  const stopAudio = () => { cancelAnimationFrame(animation); animation = null; source?.disconnect(); source = null; analyser?.disconnect(); analyser = null; smoothed = 0; presentation?.stop(); audioEpoch++; if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null } if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null; audioState = 'idle' }
  const playAudio = async (wav, volume, current) => {
    stopAudio(); const epoch = audioEpoch
    const started = performance.now()
    // Native asynchronous decoding avoids a per-byte JavaScript loop on the render thread.
    const blob = await (await fetch(`data:audio/wav;base64,${wav}`)).blob()
    if (epoch !== audioEpoch || !current()) return
    audioUrl = URL.createObjectURL(blob)
    playbackTiming = { decodeMs: +(performance.now()-started).toFixed(1) }
    const player = new Audio(audioUrl); audio = player; player.volume = volume; audioState = 'starting'
    player.onended = () => { if (epoch === audioEpoch) { audioState = 'ended'; cancelAnimationFrame(animation); presentation?.setAudioLevel(0); presentation?.setFace(overlay ? 'responding' : 'idle'); URL.revokeObjectURL(audioUrl); audioUrl = null } }
    player.onerror = () => { if (epoch === audioEpoch) { audioState = 'error'; cancelAnimationFrame(animation); presentation?.stop() } }
    if (presentation) {
      context ||= new AudioContext()
      playbackTiming.contextCreatedMs = +(performance.now()-started).toFixed(1)
      await context.resume()
      if (epoch !== audioEpoch || !current()) return
      source = context.createMediaElementSource(player); analyser = context.createAnalyser(); analyser.fftSize = 512
      source.connect(analyser); analyser.connect(context.destination)
    }
    playbackTiming.graphReadyMs = +(performance.now()-started).toFixed(1)
    await player.play()
    playbackTiming.playingMs = +(performance.now()-started).toFixed(1)
    if (epoch !== audioEpoch || !current()) { player.pause(); return }
    audioState = 'playing'; presentation?.setFace('speaking')
    if (analyser) {
      const samples = new Float32Array(analyser.fftSize)
      const frame = () => {
        if (epoch !== audioEpoch || audioState !== 'playing') return
        analyser.getFloatTimeDomainData(samples)
        const target = audioEnergy(samples); smoothed += (target-smoothed) * (target > smoothed ? 0.55 : 0.25)
        presentation.setAudioLevel(smoothed); animation = requestAnimationFrame(frame)
      }
      frame()
    }
  }
  const clearText = () => { clearTimeout(timer); timer = null; if (overlay) { overlay.remove(); overlay = null } }
  const port = new BodySession({ clearText, playAudio, stopAudio, setFace: phase => presentation?.setFace(audioState === 'playing' ? 'speaking' : phase), capabilities: ['text', 'audio', 'audio-stop', 'stop'], showText(text, durationMs) {
    clearText(); if (!bubbles) { if (audioState !== 'playing') presentation?.setFace('idle'); return }; overlay = document.createElement('div'); overlay.id = 'companion-kernel-text'; overlay.textContent = text
    Object.assign(overlay.style, { position: 'fixed', top: '12px', left: '8px', right: '8px', zIndex: '100', padding: '12px', borderRadius: '16px', background: '#f5fbffff', color: '#173449', border: '1px solid #65add3', font: '16px Microsoft YaHei UI', lineHeight: '1.5', maxHeight: '32vh', overflowY: 'auto', pointerEvents: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' })
    document.body.append(overlay); timer = setTimeout(() => { clearText(); if (!['playing', 'starting'].includes(audioState)) presentation?.setFace('idle') }, durationMs)
  } })
  window.__companionBody = (op, payload) => {
    if (op === 'volume') {
      if (!Number.isFinite(payload?.value) || payload.value < 0 || payload.value > 1) return { status: 'failed' }
      if (audio) audio.volume = payload.value
      return { status: 'completed' }
    }
    if (op === 'snapshot') return { generation: port.generation, taskId: port.taskId, closed: port.closed, textVisible: !!overlay, audioState, audioVolume: audio?.volume ?? null, audioPrepared: !!context, audioWarmupMs, playbackTiming, presentation: presentation?.snapshot() || null }
    if (op === 'capabilities') return { protocol: 1, commands: [...port.capabilities], emotion: [], gaze: false, gestures: [] }
    if (op === 'begin') return port.begin(payload)
    if (op === 'execute') return port.execute(payload)
    if (op === 'stop') return port.stop(payload)
    return { status: 'unsupported' }
  }
  document.querySelector('#stage')?.addEventListener('pointerdown', event => {
    if (event.button === 0) shell?.kernelClick?.()
  })
  window.addEventListener('pagehide', () => { stopAudio(); clearText(); context?.close().catch(() => {}) }, { once: true })
  return port
}
