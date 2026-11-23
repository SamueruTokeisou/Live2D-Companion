import { ChatError } from './codex-provider.mjs'
import { localHandler } from './event-kernel.mjs'

export const CHAT_ERRORS = {
  codex_missing: '没有找到 Codex CLI，请按说明安装并登录；桌宠仍可离线互动。',
  chatgpt_login_required: '请先在 Codex CLI 使用 ChatGPT 登录；本入口不会读取或保存 API 密钥。',
  request_timeout: '本轮请求超时，已停止连接。可以重新发送。',
  backend_timeout: '后端连接超时，请稍后重试。',
  backend_unavailable: '对话后端暂不可用，桌宠仍可离线互动。',
  backend_request_failed: '后端请求失败，请检查 Codex 登录、账号额度和服务状态。',
  backend_turn_failed: '后端未能完成本轮对话，请检查账号额度或稍后重试。',
  tool_denied: '后端请求了本阶段未开放的操作，本轮已停止。',
  empty_response: '后端没有返回可显示的文字，请重新发送。',
  model_unavailable: '账号暂时没有可用模型，请检查 Codex。',
  permissions_not_applied: '后端未确认只读约束，本轮没有继续发送对话。',
  ephemeral_required: '后端不支持临时会话，本轮没有继续发送对话。',
  local_limit: '已达到本机调用次数限制，请等待一分钟；单次进程最多 24 轮。',
  body_unavailable: '文字未能显示到角色上，请检查舞台。',
  cancelled: '本轮已停止。',
}
export class ChatRuntime {
  constructor({ kernel, provider, now = () => Date.now(), maxPerMinute = 6, maxPerSession = 24 } = {}) {
    this.kernel = kernel; this.provider = provider; this.now = now; this.maxPerMinute = maxPerMinute; this.maxPerSession = maxPerSession
    this.entries = []; this.history = []; this.calls = []; this.verified = false; this.model = null; this.lastError = null
    this.knownInput = 0; this.knownOutput = 0; this.unknownUsage = 0; this.completed = 0; this.limited = 0
  }
  send(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new ChatError('invalid_input')
    const id = this.kernel.enqueue('text', { text })
    if (this.kernel.records.some(row => row.eventId === id && row.status === 'rejected')) throw new ChatError('queue_full')
    this.entries.push({ id, role: 'user', text: text.trim(), status: 'sent' }); this.trim()
    return id
  }
  trim() { if (this.entries.length > 20) this.entries.splice(0, this.entries.length - 20) }
  snapshot() {
    const recentCalls = this.calls.filter(at => at > this.now() - 60000).length
    return structuredClone({ provider: 'codex-chatgpt', verified: this.verified, model: this.model, lastError: this.lastError,
      entries: this.entries, limits: { maxInputChars: 500, maxOutputChars: 500, timeoutSeconds: 45, callsPerRound: 1, maxPerMinute: this.maxPerMinute, maxPerSession: this.maxPerSession },
      usage: { appRequests: this.calls.length, completed: this.completed, knownInputTokens: this.knownInput, knownOutputTokens: this.knownOutput, unknownUsageRounds: this.unknownUsage, limitedOutputs: this.limited, amount: null,
        remainingThisMinute: Math.max(0, this.maxPerMinute-recentCalls), remainingThisSession: Math.max(0, this.maxPerSession-this.calls.length) } })
  }
  clear() { this.kernel.cancel(); this.entries = []; this.history = []; this.lastError = null }
  async handle(event, ctx) {
    if (event.type !== 'text') return localHandler(event, ctx)
    const reply = { id: ctx.taskId, role: 'assistant', text: '', status: 'thinking' }
    this.entries.push(reply); this.trim(); this.lastError = null
    let lastPaint = -Infinity, display = Promise.resolve(), displayFailed = false, usageCounted = false
    const current = () => !ctx.signal.aborted && (ctx.isCurrent?.() ?? true)
    const paint = text => {
      display = display.then(async () => {
        if (!current()) return
        const result = await ctx.command('text', { text, durationMs: 5000 })
        if (result.status === 'failed' || result.status === 'unsupported') displayFailed = true
      }).catch(() => { displayFailed = true })
    }
    try {
      if (this.calls.length >= this.maxPerSession || this.calls.filter(at => at > this.now()-60000).length >= this.maxPerMinute) throw new ChatError('local_limit')
      this.calls.push(this.now())
      const result = await this.provider.stream({ messages: [...this.history, { role: 'user', content: event.payload.text }], signal: ctx.signal,
        onDelta: text => {
          if (!current()) return
          reply.text = text.slice(0, 500); reply.status = 'streaming'
          if (this.now() - lastPaint >= 80) { lastPaint = this.now(); paint(reply.text) }
        } })
      if (!current()) throw new ChatError('cancelled')
      this.model = result.model; this.verified = true; this.kernel.aiConnected = true
      if (result.usage) { this.knownInput += result.usage.inputTokens; this.knownOutput += result.usage.outputTokens } else this.unknownUsage++
      usageCounted = true; this.completed++; if (result.limited) this.limited++
      reply.text = result.text.slice(0, 500); paint(reply.text); await display
      if (!current()) throw new ChatError('cancelled')
      if (displayFailed) throw new ChatError('body_unavailable')
      reply.status = 'completed'; reply.limited = !!result.limited
      this.history.push({ role: 'user', content: event.payload.text }, { role: 'assistant', content: reply.text })
      this.history = this.history.slice(-6)
      await ctx.sleep(4000)
    } catch (error) {
      if (!usageCounted && error.code !== 'local_limit') this.unknownUsage++
      if (reply.status !== 'completed') {
        const code = current() ? (Object.hasOwn(CHAT_ERRORS, error.code) ? error.code : 'backend_unavailable') : 'cancelled'
        reply.status = code === 'cancelled' ? 'cancelled' : 'failed'; reply.error = CHAT_ERRORS[code]
        if (code !== 'cancelled') this.lastError = { code, message: CHAT_ERRORS[code] }
      }
      throw error
    }
  }
}
