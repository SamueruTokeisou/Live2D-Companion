const $ = id => document.getElementById(id)
const labels = { idle: '待机', thinking: '处理事件中', responding: '正在回应', paused: '已暂停', error: '出错，可重试下一条' }
let paused = false, polling = false, enabled = false
async function call(op, payload) {
  const reply = await window.shell.stageRpc('kernel:' + op, payload)
  if (!reply?.ok) throw new Error(reply?.error || '操作失败')
  return reply.value
}
async function action(fn) { try { $('error').textContent = ''; await fn(); await refresh() } catch (error) { $('error').textContent = error.message } }
async function refresh() {
  if (polling) return
  polling = true
  try {
    const s = await call('snapshot'); paused = s.paused; enabled = s.enabled
    $('disable').textContent = enabled ? '关闭内核测试' : '开启内核测试'
    $('status').textContent = s.enabled ? labels[s.state] : '内核测试已关闭'
    $('queue').textContent = `排队 ${s.queue.length} 项 · 定时 ${s.timers.length} 项 · 本地规则 / 无 AI`
    $('pause').textContent = paused ? '继续' : '暂停'; $('quiet').checked = s.quiet
    $('events').textContent = s.records.slice(-16).map(r => `${new Date(r.at).toLocaleTimeString()} ${r.type || ''} ${r.status}${r.taskId ? ' · ' + r.taskId.slice(-6) : ''}${r.result ? ' / ' + r.result : ''}`).join('\n')
    for (const id of ['text','stop','pause','timer','clicks','idle','quiet']) $(id).disabled = !s.enabled
  } finally { polling = false }
}
$('input').onsubmit = e => { e.preventDefault(); action(async () => { await call('event', { type: 'text', text: $('text').value }); $('text').value = '' }) }
$('stop').onclick = () => action(() => call('cancel'))
$('pause').onclick = () => action(() => call('pause', { value: !paused }))
$('timer').onclick = () => action(() => call('timer', { ms: 2000 }))
$('clicks').onclick = () => action(async () => { for (let i = 0; i < 5; i++) await call('event', { type: 'click' }) })
$('idle').onclick = () => action(() => call('event', { type: 'idle' }))
$('quiet').onchange = () => action(() => call('quiet', { value: $('quiet').checked }))
$('disable').onclick = () => action(() => call('enable', { value: !enabled }))
await action(async () => {
  await call('enable', { value: true })
  const c = await call('capabilities'); $('capabilities').textContent = '当前身体支持：显示文字、停止。情绪、视线和手势返回“不支持”，后续再适配。'
  if (!c.commands.includes('text')) throw new Error('身体暂未就绪，请重新打开测试')
})
const poll = setInterval(() => refresh().catch(() => { $('error').textContent = '暂时无法读取内核状态。' }), 300)
window.addEventListener('pagehide', () => { clearInterval(poll); window.shell.stageRpc('kernel:enable', { value: false }).catch(() => {}) }, { once: true })
