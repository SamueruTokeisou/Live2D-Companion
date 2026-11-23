const $ = id => document.getElementById(id)
const states = { idle: '待机', thinking: '正在等待模型', responding: '正在回应', paused: '已关闭', error: '本轮出错，可以重试' }
const statuses = { thinking: '等待中', streaming: '正在输出', completed: '已完成', cancelled: '已停止', failed: '未完成' }
let enabled = false, refreshing = false, lastEntries = ''
async function call(op, payload) {
  const reply = await window.shell.stageRpc('chat:' + op, payload)
  if (!reply?.ok) throw Error(reply?.error || '操作未完成')
  return reply.value
}
function render(s) {
  enabled = s.enabled
  $('status').textContent = `${enabled ? states[s.state] : '文字对话已关闭'} · ${s.verified ? '真实后端已验证' : '真实后端尚未验证'}${s.model ? ' · ' + s.model : ''}`
  $('toggle').textContent = enabled ? '关闭对话' : '开启对话'
  $('text').disabled = !enabled; $('send').disabled = !enabled; $('stop').disabled = !enabled
  $('error').textContent = s.lastError?.message || ''
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
async function action(fn) { try { render(await fn()) } catch (error) { $('error').textContent = error.message } }
$('input').onsubmit = event => { event.preventDefault(); const text = $('text').value; action(async () => { const s = await call('send', { text }); $('text').value = ''; return s }) }
$('stop').onclick = () => action(() => call('stop'))
$('clear').onclick = () => action(() => call('clear'))
$('toggle').onclick = () => action(() => call('enable', { value: !enabled }))
await action(() => call('enable', { value: true }))
const poll = setInterval(refresh, 200)
window.addEventListener('pagehide', () => { clearInterval(poll); window.shell.stageRpc('chat:enable', { value: false }).catch(() => {}) }, { once: true })
