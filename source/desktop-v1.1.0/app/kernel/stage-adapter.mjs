/** Constant RPC operations, serialized envelopes; no generated model code. */
export class StageBodyAdapter {
  constructor(rpc, { timeoutMs = 3000, clock = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) } } = {}) {
    this.rpc = rpc; this.timeoutMs = timeoutMs; this.clock = clock
  }
  async call(op, payload) {
    let timer
    try {
      const reply = await Promise.race([
        this.rpc('body:' + op, payload),
        new Promise((_, reject) => { timer = this.clock.set(() => reject(new Error('body timeout')), this.timeoutMs) }),
      ])
      if (!reply?.ok || !reply.value) throw new Error('body unavailable')
      return reply.value
    } finally { this.clock.clear(timer) }
  }
  capabilities() { return this.call('capabilities') }
  begin(task) { return this.call('begin', task) }
  execute(command) { return this.call('execute', command) }
  stop(task) { return this.call('stop', task) }
}
