const $ = id => document.getElementById(id)
const states = { idle: '待机', thinking: '正在等待模型', responding: '正在回应', paused: '已关闭', error: '本轮出错，可以重试' }
const statuses = { thinking: '等待中', streaming: '正在输出', completed: '已完成', cancelled: '已停止', failed: '未完成' }
let voiceEnabled = false
let enabled = false, refreshing = false, lastEntries = '', accountsKey = '', modelsKey = '', actionError = ''
async function call(op, payload) {
  const reply = await window.shell.stageRpc('chat:' + op, payload)
  if (!reply?.ok) throw Error(reply?.error || '操作未完成')
  return reply.value
}
function render(s) {
  enabled = s.enabled
  voiceEnabled = !!s.speech?.enabled; $('voice').disabled = !s.speech?.configured
  $('voice').textContent = !s.speech?.configured ? '声音准备中' : voiceEnabled ? '关闭日语朗读' : '开启日语朗读'
  $('status').textContent = `${enabled ? states[s.state] : '文字对话已关闭'} · ${s.verified ? '真实后端已验证' : '真实后端尚未验证'}${s.model ? ' · ' + s.model : ''}`
  $('toggle').textContent = enabled ? '关闭对话' : '开启对话'
  const auth = s.auth || {}, ready = enabled && auth.signedIn && auth.planEnabled && !auth.needsWelcome && !auth.pending
  $('text').disabled = !ready; $('send').disabled = !ready; $('stop').disabled = !enabled
  $('welcome').hidden = !auth.needsWelcome; $('cancel-login').hidden = !auth.pending
  $('login').disabled = auth.pending; $('add-account').disabled = auth.pending; $('logout').disabled = !auth.signedIn
  $('auth-status').textContent = auth.pending ? '等待你在 OpenAI 官方页面完成登录与套餐授权…' : auth.lastError ? (auth.lastError === 'consent_declined' ? '你未授权，可重新登录。' : '登录未完成，请重试。') : auth.notice === 'revocation_unconfirmed' ? '本机已退出；远程撤销未确认，请到ChatGPT设置断开应用。' : auth.planEnabled ? 'Using ChatGPT plan · 正在使用 ChatGPT 套餐' : auth.signedIn ? '已登录，但尚未授权使用套餐；请重新登录并授权。' : '尚未登录 ChatGPT'
  const ak = JSON.stringify([auth.accounts, auth.selected])
  if (ak !== accountsKey) { $('accounts').replaceChildren(...(auth.accounts?.length ? auth.accounts : [{ id: '', label: '尚无登录账号' }]).map(a => new Option(a.label, a.id, false, a.id === auth.selected))); accountsKey = ak }
  const mk = JSON.stringify([s.models, s.selectedModel])
  if (mk !== modelsKey) { $('models').replaceChildren(...(s.models?.length ? s.models : [{ slug: '', displayName: '授权后刷新模型' }]).map(m => new Option(m.displayName, m.slug, false, m.slug === s.selectedModel))); modelsKey = mk }
  $('models').disabled = !ready; $('reload-models').disabled = !ready
  $('error').textContent = s.lastError?.message || s.speech?.lastError || actionError
  const content = JSON.stringify(s.entries)
  if (content !== lastEntries) {
    const nearBottom = $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 80
    $('messages').replaceChildren()
    for (const entry of s.entries) {
      const box = document.createElement('div'); box.className = 'message ' + entry.role
      const title = document.createElement('div'); title.className = 'meta'; title.textContent = entry.role === 'user' ? '你' : `伙伴 · ${statuses[entry.status] || entry.status}${entry.limited ? ' · 已达到输出上限' : ''}`
      const text = document.createElement('div'); text.textContent = entry.text || (entry.status === 'thinking' ? '…' : '')
      box.append(title, text)
      if (entry.error) { const error = document.createElement('div'); error.className = 'meta'; error.textContent = entry.error; box.append(error) }
      $('messages').append(box)
    }
    if (nearBottom) $('messages').scrollTop = $('messages').scrollHeight
    lastEntries = content
  }
  $('usage').textContent = `本次启动已发起 ${s.usage.appRequests}/${s.limits.maxPerSession} 轮，当前分钟还可发起 ${s.usage.remainingThisMinute} 轮。每轮最多 1 次对话请求，45 秒、500 字符输出上限，本程序不自动重试。\n已知用量：输入 ${s.usage.knownInputTokens}、输出 ${s.usage.knownOutputTokens} token；${s.usage.unknownUsageRounds} 轮用量未知。金额未知；实际额度以账号为准；停止前已经生成的内容仍可能计入用量。`
}
async function refresh() {
  if (refreshing) return
  refreshing = true
  try { render(await call('snapshot')) } catch { $('error').textContent = '暂时无法连接舞台，请检查桌宠是否运行。' } finally { refreshing = false }
}
async function action(fn) { actionError = ''; try { render(await fn()) } catch (error) { actionError = error.message; $('error').textContent = actionError } }
$('input').onsubmit = event => { event.preventDefault(); const text = $('text').value; action(async () => { const s = await call('send', { text }); $('text').value = ''; return s }) }
$('stop').onclick = () => action(() => call('stop'))
$('clear').onclick = () => action(() => call('clear'))
$('toggle').onclick = () => action(() => call('enable', { value: !enabled }))
$('voice').onclick = () => action(() => call('voice', { value: !voiceEnabled }))
$('login').onclick = () => action(() => call('login'))
$('add-account').onclick = () => action(() => call('login', { newAccount: true }))
$('cancel-login').onclick = () => action(() => call('cancel-login'))
$('logout').onclick = () => action(() => call('logout'))
$('accounts').onchange = () => action(() => call('account', { id: $('accounts').value }))
$('models').onchange = () => action(() => call('model', { model: $('models').value }))
$('reload-models').onclick = () => action(() => call('models'))
$('manage-usage').onclick = () => action(() => call('manage-usage'))
$('ack').onclick = () => action(() => call('ack'))
await action(() => call('enable', { value: true }))
const poll = setInterval(refresh, 200)
window.addEventListener('pagehide', () => { clearInterval(poll); window.shell.stageRpc('chat:enable', { value: false }).catch(() => {}) }, { once: true })
