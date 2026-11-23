import { ChatError } from './chat-errors.mjs'

function failure(status, code) {
  if (code === 'subscription_sharing_usage_limit_exceeded' || status === 429) return new ChatError('plan_limit')
  if (code === 'subscription_sharing_usage_unavailable') return new ChatError('plan_unavailable')
  if (status === 401) return new ChatError('signin_required')
  if (status === 403) return new ChatError('plan_permission_required')
  return new ChatError('backend_request_failed')
}
export class ChatGptProvider {
  constructor({ auth, fetchImpl = fetch }) { this.id = 'chatgpt-plan'; this.auth = auth; this.fetch = fetchImpl; this.models = []; this.model = null; this.catalogEpoch = 0 }
  clearModels() { this.catalogEpoch++; this.models = []; this.model = null }
  select(model) { if (!this.models.some(m => m.slug === model)) throw new ChatError('model_unavailable'); this.model = model }
  async loadModels() {
    const epoch = this.catalogEpoch, token = await this.auth.token()
    const response = await this.fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000), redirect: 'error' })
    if (!response.ok) throw failure(response.status)
    const body = await response.json()
    if (epoch !== this.catalogEpoch) throw new ChatError('account_changed')
    this.models = (body.models || []).filter(m => m.visibility === 'list' && typeof m.slug === 'string' && typeof m.display_name === 'string').map(m => ({ slug: m.slug, displayName: m.display_name }))
    if (!this.models.length) throw new ChatError('model_unavailable')
    if (!this.models.some(m => m.slug === this.model)) this.model = this.models[0].slug
    return this.models
  }
  async stream({ messages, signal, onDelta }) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort('timeout'), 45000)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    let reader
    try {
      if (!this.models.length) await this.loadModels()
      if (combined.aborted) throw new ChatError(signal?.aborted ? 'cancelled' : 'request_timeout')
      const model = this.model, token = await this.auth.token()
      const response = await this.fetch('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, store: false, stream: true, instructions: '你是用户的桌面AI助手。用户可以用中文或日文输入；你的回答只使用自然、简短的日语，通常不超过150字。不附中文翻译、罗马音或双语字幕。保持普通AI对话，不扮演任何动漫角色、不编造固定人物性格。只进行文字聊天，不声称执行电脑操作。', input: messages.slice(-7).map(m => ({ role: m.role, content: m.content })) }) })
      if (!response.ok) {
        let code; try { code = (await response.json()).error?.code } catch {}
        throw failure(response.status, code)
      }
      if (!response.body) throw new ChatError('incomplete_response')
      reader = response.body.getReader()
      const decoder = new TextDecoder(); let buffer = '', text = '', usage = null, completed = false
      const event = block => {
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data || data === '[DONE]') return
        let item; try { item = JSON.parse(data) } catch { throw new ChatError('incomplete_response') }
        if (item.type === 'response.output_text.delta') {
          text += item.delta || ''
          onDelta(text.slice(0, 500))
          if (text.length > 500) throw new ChatError('output_limit')
        } else if (item.type === 'response.completed') {
          completed = true
          const u = item.response?.usage
          if (Number.isSafeInteger(u?.input_tokens) && u.input_tokens >= 0 && Number.isSafeInteger(u?.output_tokens) && u.output_tokens >= 0) usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens }
        } else if (item.type === 'response.failed' || item.type === 'error') throw failure(0, item.response?.error?.code || item.code || item.error?.code)
        else if (item.type === 'response.incomplete') throw new ChatError('incomplete_response')
      }
      while (true) {
        const part = await reader.read()
        buffer = (buffer + decoder.decode(part.value, { stream: !part.done })).replace(/\r\n/g, '\n')
        if (buffer.length > 1024 * 1024) throw new ChatError('incomplete_response')
        let end; while ((end = buffer.indexOf('\n\n')) !== -1) { event(buffer.slice(0, end)); buffer = buffer.slice(end + 2) }
        if (part.done) { if (buffer.trim()) event(buffer); break }
      }
      if (!completed) throw new ChatError('incomplete_response')
      if (!text.trim()) throw new ChatError('empty_response')
      return { text, usage, model, limited: false, provider: this.id }
    } catch (error) {
      if (signal?.aborted) throw new ChatError('cancelled')
      if (controller.signal.aborted) throw new ChatError('request_timeout')
      if (error instanceof ChatError) throw error
      throw new ChatError('backend_unavailable')
    } finally { clearTimeout(timer); controller.abort(); try { await reader?.cancel() } catch {} }
  }
}
