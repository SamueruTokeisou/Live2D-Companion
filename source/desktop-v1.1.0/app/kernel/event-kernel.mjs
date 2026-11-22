import { randomUUID } from 'node:crypto'

const realClock = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) }
const priority = { text: 4, click: 3, timer: 2, idle: 1 }
const sources = { text: 'user', click: 'pointer', timer: 'clock', idle: 'local' }
const terminal = new Set(['completed', 'cancelled', 'failed', 'unsupported'])

/** Single-task local kernel. Inject clock/handler/body for deterministic tests. */
export class EventKernel {
  constructor({ body, handler = localHandler, clock = realClock, journal = () => {}, timeoutMs = 8000, batchMs = 120, maxQueue = 64 } = {}) {
    if (!body || typeof body.execute !== 'function') throw new TypeError('body required')
    this.body = body; this.handler = handler; this.clock = clock; this.journal = journal
    this.timeoutMs = timeoutMs; this.batchMs = batchMs; this.maxQueue = maxQueue
    this.session = randomUUID(); this.sequence = 0; this.queue = []; this.timers = new Map()
    this.active = null; this.paused = false; this.quiet = false; this.closed = false
    this.state = 'idle'; this.records = []; this.listeners = new Set(); this.pumpTimer = null
  }
  record(event, status, extra = {}) {
    const row = { at: this.clock.now(), eventId: event?.id ?? null, type: event?.type ?? null, source: event?.source ?? null, taskId: null, status, ...extra }
    this.records.push(row); if (this.records.length > 256) this.records.shift()
    try { this.journal({ ...row }) } catch { /* Diagnostic failure must not block the companion. */ }
    this.notify()
  }
  snapshot() {
    return structuredClone({ mode: 'local-test', aiConnected: false, state: this.state, paused: this.paused, quiet: this.quiet,
      active: this.active ? { taskId: this.active.id, eventId: this.active.event.id, type: this.active.event.type } : null,
      queue: this.queue.map(e => ({ id: e.id, type: e.type, count: e.ids.length })), timers: [...this.timers.keys()], records: this.records })
  }
  notify() { for (const fn of this.listeners) { try { fn(this.snapshot()) } catch {} } }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  setState(value) { this.state = value; this.notify() }
  makeEvent(type, payload = {}) {
    if (!Object.hasOwn(priority, type)) throw new TypeError('unsupported event type')
    if (type === 'text' && (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 500)) throw new TypeError('text must be 1..500 characters')
    const event = { id: randomUUID(), type, source: sources[type], at: this.clock.now(), payload: type === 'text' ? { text: payload.text.trim() } : {} }
    event.ids = [event.id]; return event
  }
  enqueue(type, payload = {}) { return this.accept(this.makeEvent(type, payload)) }
  accept(event) {
    if (this.closed) throw new Error('kernel closed')
    if (this.quiet && event.type !== 'text') { this.record(event, 'suppressed'); return event.id }
    const sibling = event.type !== 'text' && this.queue.find(e => e.type === event.type && e.ids.length < 64 && this.clock.now() < e.readyAt)
    if (sibling) {
      sibling.ids.push(event.id); this.record(event, 'merged', { batchId: sibling.id }); this.notify(); return event.id
    }
    if (this.queue.length >= this.maxQueue && event.type === 'text') {
      const candidate = [...this.queue].sort((a, b) => priority[a.type] - priority[b.type]).find(e => e.type !== 'text')
      if (candidate) for (const id of [...candidate.ids]) this.cancel(id)
    }
    if (this.queue.length >= this.maxQueue) { this.record(event, 'rejected', { reason: 'queue_full' }); return event.id }
    event.readyAt = this.clock.now() + (event.type === 'text' ? 0 : this.batchMs)
    this.queue.push(event); this.record(event, 'queued')
    if (this.active && (event.type === 'text' || priority[event.type] > priority[this.active.event.type])) this.cancelActive('preempted')
    this.pump(); return event.id
  }
  pump() {
    if (this.pumpTimer !== null) { this.clock.clear(this.pumpTimer); this.pumpTimer = null }
    if (this.closed || this.paused || this.active || !this.queue.length) return
    // A high-priority event waiting for its batch window also holds lower priorities.
    this.queue.sort((a, b) => priority[b.type] - priority[a.type] || a.at - b.at)
    const event = this.queue[0]; const delay = Math.max(0, event.readyAt - this.clock.now())
    this.pumpTimer = this.clock.set(() => { this.pumpTimer = null; if (this.paused || this.active || this.closed) return
      this.queue.shift(); this.run(event)
    }, delay)
  }
  run(event) {
    const task = { id: `${this.session}:${++this.sequence}`, generation: this.sequence, event, deadlineAt: this.clock.now() + this.timeoutMs, controller: new AbortController(), finished: false, commandSequence: 0 }
    this.active = task; this.setState('thinking')
    for (const id of event.ids) this.record({ ...event, id }, 'running', { taskId: task.id })
    task.deadline = this.clock.set(() => this.finish(task, 'timeout'), this.timeoutMs)
    const current = () => this.active === task && !task.finished && !task.controller.signal.aborted && this.clock.now() < task.deadlineAt
    const command = async (kind, payload = {}) => {
      if (!current()) return { status: 'cancelled', taskId: task.id }
      this.setState('responding')
      const envelope = { taskId: task.id, generation: task.generation, commandId: `${task.id}/${++task.commandSequence}`, kind, payload }
      const result = await this.body.execute(envelope, task.controller.signal)
      if (!current()) return { status: 'cancelled', taskId: task.id }
      if (!result || !terminal.has(result.status) || result.taskId !== task.id || result.commandId !== envelope.commandId) throw new Error('invalid body receipt')
      this.record(event, 'body_result', { taskId: task.id, commandId: envelope.commandId, result: result.status })
      if (result.status === 'failed') throw new Error('body failed')
      if (result.status === 'cancelled') this.finish(task, 'cancelled', 'body_cancelled')
      return result
    }
    Promise.resolve().then(async () => {
      if (!current()) return
      const begun = await this.body.begin({ taskId: task.id, generation: task.generation })
      if (current() && (begun?.status !== 'accepted' || begun.taskId !== task.id)) throw new Error('body begin rejected')
      if (!current()) return
      await this.handler(event, { signal: task.controller.signal, command, sleep: ms => this.sleep(ms, task.controller.signal), taskId: task.id })
      if (current()) this.finish(task, 'completed')
    }).catch(() => { if (current()) this.finish(task, 'failed') })
  }
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('cancelled')); return }
      const abort = () => { this.clock.clear(timer); signal.removeEventListener('abort', abort); reject(new Error('cancelled')) }
      const timer = this.clock.set(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  finish(task, status, reason = status) {
    if (task.finished) return
    task.finished = true; task.controller.abort(); this.clock.clear(task.deadline)
    // stop is sent before another task's begin; renderer additionally fences by generation.
    try { Promise.resolve(this.body.stop({ taskId: task.id, generation: task.generation })).catch(() => {}) } catch {}
    for (const id of task.event.ids) this.record({ ...task.event, id }, status, { taskId: task.id, reason })
    if (this.active === task) this.active = null
    this.setState(this.paused ? 'paused' : ['failed', 'timeout'].includes(status) ? 'error' : 'idle')
    this.pump()
  }
  cancelActive(reason = 'user') { if (this.active) this.finish(this.active, 'cancelled', reason) }
  cancel(eventId = null) {
    for (const [id, timer] of this.timers) if (!eventId || id === eventId) { this.clock.clear(timer); this.timers.delete(id); this.record({ id, type: 'timer', source: 'clock' }, 'cancelled') }
    this.queue = this.queue.filter(event => {
      const removed = event.ids.filter(id => !eventId || id === eventId)
      for (const id of removed) this.record({ ...event, id }, 'cancelled')
      event.ids = event.ids.filter(id => !removed.includes(id)); if (event.ids.length) event.id = event.ids[0]; return event.ids.length > 0
    })
    if (this.active && (!eventId || this.active.event.ids.includes(eventId))) this.cancelActive()
    this.notify(); this.pump()
  }
  pause(value = true) {
    const next = !!value
    if (next === this.paused) return
    this.paused = next
    if (this.paused) this.cancelActive('paused')
    this.setState(this.paused ? 'paused' : 'idle'); this.pump()
  }
  setQuiet(value) {
    this.quiet = !!value
    if (this.quiet) {
      for (const event of [...this.queue]) if (event.type !== 'text') {
        for (const id of [...event.ids]) this.cancel(id)
      }
      if (this.active?.event.type !== 'text') this.cancelActive('quiet')
    }
    this.notify()
  }
  scheduleTimer(ms = 2000) {
    if (!Number.isFinite(ms) || ms < 100 || ms > 60000 || this.timers.size >= 16 || this.closed) throw new TypeError('timer limit')
    const event = this.makeEvent('timer')
    const timer = this.clock.set(() => { this.timers.delete(event.id); this.accept(event) }, ms)
    this.timers.set(event.id, timer); this.record(event, 'scheduled'); return event.id
  }
  close() { this.closed = true; this.cancel(); if (this.pumpTimer !== null) this.clock.clear(this.pumpTimer); this.listeners.clear() }
}

/** Engineering fixture only: deterministic local rules, no language-model calls. */
export async function localHandler(event, ctx) {
  await ctx.sleep(400)
  const text = event.type === 'text' ? `本地测试收到：${event.payload.text}`
    : event.type === 'click' ? `收到 ${event.ids.length} 次点击。` : event.type === 'timer' ? '本地计时事件到了。' : '本地待机事件。'
  await ctx.command('text', { text, durationMs: 1500 })
  await ctx.sleep(1500)
}
