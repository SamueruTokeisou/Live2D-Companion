import { existsSync, readFileSync } from 'node:fs'
import { writeSettings } from '../persistence.mjs'
import { ChatError } from './chat-errors.mjs'

/** Optional local speech. Configuration and reference recordings never enter the renderer. */
export class LocalSpeech {
  constructor({ configFile, fetchImpl = fetch, timeoutMs = 30000, probeTimeoutMs = 1500 }) { this.timeoutMs = timeoutMs; this.probeTimeoutMs = probeTimeoutMs; this.blocked = false; this.configFile = configFile; this.fetch = fetchImpl; this.error = null; this.busy = false; this.service = 'unknown'; this.probing = null }
  settings() {
    if (!existsSync(this.configFile)) return null
    try {
      const c = JSON.parse(readFileSync(this.configFile, 'utf8'))
      if (typeof c.reference !== 'string' || !existsSync(c.reference) || typeof c.promptText !== 'string' || !c.promptText.trim()) return null
      return c
    } catch { return null }
  }
  config() { const c = this.settings(); return c?.enabled === true ? c : null }
  setEnabled(value) {
    if (typeof value !== 'boolean' || !this.settings()) throw new ChatError('speech_not_configured')
    const config = this.settings(); config.enabled = value; writeSettings(this.configFile, config); this.error = null
  }
  setVolume(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new ChatError('invalid_volume')
    const config = this.settings(); if (!config) throw new ChatError('speech_not_configured')
    config.volume = value; writeSettings(this.configFile, config)
  }
  snapshot() { const c = this.settings(); return { configured: !!c, enabled: !!this.config(), volume: Number.isFinite(c?.volume) ? Math.max(0, Math.min(1, c.volume)) : 0.7, busy: this.busy, service: this.service, lastError: this.error, engine: 'GPT-SoVITS', language: c?.textLanguage === 'ja' ? 'ja' : 'zh' } }
  async checkService() {
    if (this.probing) return this.probing
    this.service = 'checking'
    this.probing = Promise.resolve().then(async () => {
      try {
        const response = await this.fetch('http://127.0.0.1:9880/openapi.json', { redirect: 'error', signal: AbortSignal.timeout(this.probeTimeoutMs) })
        if (!response.ok) { this.service = 'incompatible'; return }
        const schema = await response.json()
        this.service = schema?.paths?.['/tts']?.post ? 'ready' : 'incompatible'
      } catch { this.service = 'offline' }
    }).finally(() => { this.probing = null })
    return this.probing
  }
  async speak(text, ctx) {
    const config = this.config(); if (!config) return false
    if (this.blocked) { this.error = '上一轮语音超时，本次进程已暂停语音。请重启语音服务和桌宠后再试。'; return false }
    if (this.busy) { this.error = '上一轮语音仍在结束，本轮保留文字回应。'; return false }
    this.busy = true; this.error = null
    const current = () => !ctx.signal.aborted && ctx.isCurrent()
    const timeout = AbortSignal.timeout(this.timeoutMs)
    try {
      const response = await this.fetch('http://127.0.0.1:9880/tts', { method: 'POST', redirect: 'error', signal: timeout,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 500), text_lang: config.textLanguage === 'ja' ? 'ja' : 'zh', ref_audio_path: config.reference, prompt_text: config.promptText,
          prompt_lang: config.promptLanguage === 'ja' ? 'ja' : 'zh', batch_size: 1, parallel_infer: false, text_split_method: 'cut5', streaming_mode: false, media_type: 'wav', seed: 42 }) })
      if (!response.ok || !response.body) throw Error('speech unavailable')
      const reader = response.body.getReader(); const parts = []; let size = 0
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8 * 2**20) throw Error('speech too large'); parts.push(Buffer.from(value)) }
      } finally { await reader.cancel().catch(() => {}) }
      const data = Buffer.concat(parts)
      if (!current()) return false
      if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw Error('invalid speech')
      this.service = 'ready'
      const volume = this.settings()?.volume ?? config.volume
      const reply = await ctx.command('audio', { wav: data.toString('base64'), volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.7 })
      if (reply.status !== 'completed') throw Error('playback failed')
      // Playback completion is observed through the body, not inferred from byte count.
      for (let elapsed = 0; elapsed < 35000 && current(); elapsed += 500) {
        const state = await ctx.speechState()
        if (state.taskId !== ctx.taskId || state.closed) return false
        if (state.audioState === 'ended') return true
        if (state.audioState === 'error') throw Error('playback failed')
        if (elapsed % 3000 === 0) await ctx.command('text', { text, durationMs: 5000 })
        await ctx.sleep(500)
      }
      if (current()) throw Error('playback timeout')
      return false
    } catch {
      if (timeout.aborted) this.blocked = true
      if (current()) { this.error = '语音暂不可用，本轮保留文字回应。'; await ctx.command('audio-stop').catch(() => {}) }
      return false
    } finally { this.busy = false }
  }
}
