/** A body owns its own rendering; no model parameter IDs enter the kernel. */
export class BodySession {
  constructor({ showText, clearText, capabilities = ['text', 'stop'] }) {
    this.showText = showText; this.clearText = clearText; this.capabilities = capabilities
    this.generation = 0; this.taskId = null; this.closed = true; this.seen = new Set()
  }
  begin({ taskId, generation }) {
    if (typeof taskId !== 'string' || !Number.isSafeInteger(generation) || generation <= this.generation) return { status: 'cancelled', taskId }
    this.clearText(); this.generation = generation; this.taskId = taskId; this.closed = false; this.seen.clear()
    return { status: 'accepted', taskId }
  }
  execute(command) {
    const { taskId, generation, commandId, kind, payload } = command ?? {}
    const receipt = status => ({ status, taskId, commandId })
    if (this.closed || generation !== this.generation || taskId !== this.taskId) return receipt('cancelled')
    if (typeof commandId !== 'string' || this.seen.has(commandId)) return receipt('cancelled')
    if (!this.capabilities.includes(kind)) return receipt('unsupported')
    if (kind === 'stop') { this.seen.add(commandId); const stopped = this.stop({ taskId, generation }); return receipt(stopped.status) }
    if (kind === 'text') {
      if (typeof payload?.text !== 'string' || !payload.text.trim() || payload.text.length > 600 || !Number.isFinite(payload.durationMs) || payload.durationMs < 100 || payload.durationMs > 10000) return receipt('failed')
      this.seen.add(commandId)
      this.showText(payload.text, payload.durationMs, taskId)
      return receipt('completed')  // Text display applied; task controls its display lifetime.
    }
    return receipt('unsupported')
  }
  stop({ taskId, generation }) {
    if (generation < this.generation || (generation === this.generation && this.taskId !== null && taskId !== this.taskId)) return { status: 'cancelled', taskId }
    if (!Number.isSafeInteger(generation)) return { status: 'failed', taskId }
    this.generation = generation; this.taskId = taskId; this.closed = true; this.clearText()
    return { status: 'completed', taskId }
  }
}

/** Separate overlay: stopping a kernel task never clears manual clothes/expressions. */
export function installBodyPort(shell = window.shell) {
  let overlay = null, timer = null
  const clearText = () => { clearTimeout(timer); timer = null; if (overlay) { overlay.remove(); overlay = null } }
  const port = new BodySession({ clearText, showText(text, durationMs) {
    clearText(); overlay = document.createElement('div'); overlay.id = 'companion-kernel-text'; overlay.textContent = text
    Object.assign(overlay.style, { position: 'fixed', top: '12px', left: '8px', right: '8px', zIndex: '100', padding: '12px', borderRadius: '16px', background: '#f5fbffff', color: '#173449', border: '1px solid #65add3', font: '16px Microsoft YaHei UI', pointerEvents: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' })
    document.body.append(overlay); timer = setTimeout(clearText, durationMs)
  } })
  window.__companionBody = (op, payload) => {
    if (op === 'snapshot') return { generation: port.generation, taskId: port.taskId, closed: port.closed, textVisible: !!overlay }
    if (op === 'capabilities') return { protocol: 1, commands: [...port.capabilities], emotion: [], gaze: false, gestures: [] }
    if (op === 'begin') return port.begin(payload)
    if (op === 'execute') return port.execute(payload)
    if (op === 'stop') return port.stop(payload)
    return { status: 'unsupported' }
  }
  document.querySelector('#stage')?.addEventListener('pointerdown', event => {
    if (event.button === 0) shell?.kernelClick?.()
  })
  window.addEventListener('pagehide', clearText, { once: true })
  return port
}
