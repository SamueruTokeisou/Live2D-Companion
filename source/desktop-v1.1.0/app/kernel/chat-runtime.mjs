import { ChatError } from './chat-errors.mjs'
import { localHandler } from './event-kernel.mjs'

export const CHAT_ERRORS = {
  signin_required: '请点击 Continue with ChatGPT 登录。',
  signin_pending: '请在官方浏览器页面完成登录与授权。',
  plan_permission_required: '尚未获得套餐使用授权，请重新登录并授权。',
  welcome_required: '请先确认使用 ChatGPT 套餐。',
  plan_limit: 'ChatGPT 套餐额度已达上限，请点击查看用量；不会自动切换付费接口。',
  plan_unavailable: '当前账号暂时无法使用套餐额度，请查看账号用量。',
  incomplete_response: '本轮连接中断或未完成，部分文字不计入后续上下文。',
  output_limit: '达到本地500字符上限，已停止；本轮未完成。',
  account_changed: '账号已切换，本轮已停止。',
  secure_storage_unavailable: 'Windows安全存储不可用，未保存登录信息。',
  credentials_unreadable: '无法读取本机加密登录信息，原记录已保留。请检查登录存储，不要删除账号文件。',
  signin_failed: '登录未完成，请重新尝试。',
  signin_timeout: '登录等待超时，请重新登录。',
  consent_declined: '本次没有获得授权，可以重新登录。',
  browser_open_failed: '无法打开官方登录页面，请检查默认浏览器。',
  revocation_unconfirmed: '本机已退出；远程撤销未确认，请到ChatGPT设置断开应用。',

  codex_missing: '没有找到 Codex CLI，请按说明安装并登录；桌宠仍可离线互动。',
  chatgpt_login_required: '请先在 Codex CLI 使用 ChatGPT 登录；本入口不会读取或保存 API 密钥。',
  request_timeout: '本轮请求超时，已停止连接。可以重新发送。',
  backend_timeout: '后端连接超时，请稍后重试。',
  backend_unavailable: '对话后端暂不可用，桌宠仍可离线互动。',
  backend_request_failed: '请求失败，请检查登录、套餐额度和服务状态。',
  backend_turn_failed: '后端未能完成本轮对话，请检查账号额度或稍后重试。',
  tool_denied: '后端请求了本阶段未开放的操作，本轮已停止。',
  empty_response: '后端没有返回可显示的文字，请重新发送。',
  model_unavailable: '当前账号没有可用模型，请重新登录或稍后重试。',
  permissions_not_applied: '后端未确认只读约束，本轮没有继续发送对话。',
  ephemeral_required: '后端不支持临时会话，本轮没有继续发送对话。',
  local_limit: '已达到本机调用次数限制，请等待一分钟；单次进程最多 24 轮。',
  body_unavailable: '文字未能显示到角色上，请检查舞台。',
  cancelled: '本轮已停止。',
}
export class ChatRuntime {
  constructor({ kernel, provider, speech = null, speechState = null, now = () => Date.now(), maxPerMinute = 6, maxPerSession = 24 } = {}) {
    this.kernel = kernel; this.provider = provider; this.speech = speech; this.speechState = speechState; this.now = now; this.maxPerMinute = maxPerMinute; this.maxPerSession = maxPerSession
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
    return structuredClone({ provider: this.provider.id || 'codex-chatgpt', verified: this.verified, model: this.model, lastError: this.lastError,
      entries: this.entries, speech: this.speech?.snapshot() || null, limits: { maxInputChars: 500, maxOutputChars: 500, timeoutSeconds: 45, callsPerRound: 1, maxPerMinute: this.maxPerMinute, maxPerSession: this.maxPerSession },
      usage: { appRequests: this.calls.length, completed: this.completed, knownInputTokens: this.knownInput, knownOutputTokens: this.knownOutput, unknownUsageRounds: this.unknownUsage, limitedOutputs: this.limited, amount: null,
        remainingThisMinute: Math.max(0, this.maxPerMinute-recentCalls), remainingThisSession: Math.max(0, this.maxPerSession-this.calls.length) } })
  }
  clear() { this.kernel.cancel(); this.entries = []; this.history = []; this.lastError = null }
  resetIdentity() { this.clear(); this.verified = false; this.model = null; this.kernel.aiConnected = false }
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
      if (this.speech) await this.speech.speak(reply.text, { ...ctx, speechState: this.speechState })
      if (current()) await ctx.sleep(4000)
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
