import test from 'node:test'
import assert from 'node:assert/strict'
import { EventKernel } from '../source/desktop-v1.1.0/app/kernel/event-kernel.mjs'
import { BodySession } from '../source/desktop-v1.1.0/app/kernel/body-port.mjs'

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve() }
class Clock {
  time = 0; serial = 0; timers = new Map()
  now = () => this.time
  set = (fn, ms) => { const id = ++this.serial; this.timers.set(id, { at: this.time + ms, fn }); return id }
  clear = id => this.timers.delete(id)
  async advance(ms) {
    const end = this.time + ms
    await flush()
    for (;;) {
      const next = [...this.timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0]
      if (!next) break
      this.time = next[1].at; this.timers.delete(next[0]); next[1].fn(); await flush()
    }
    this.time = end; await flush()
  }
}
function fixture(handler, options = {}) {
  const clock = new Clock(), shown = [], stopped = [], begins = []
  const session = new BodySession({ showText: text => shown.push(text), clearText() {} })
  const body = { begin: x => { begins.push(x); return session.begin(x) }, execute: x => session.execute(x), stop: x => { stopped.push(x); return session.stop(x) } }
  const kernel = new EventKernel({ clock, body, handler, timeoutMs: 1000, batchMs: 100, ...options })
  return { clock, kernel, shown, stopped, begins, session }
}
const echo = async (event, ctx) => { await ctx.command('text', { text: event.payload.text || `${event.type}:${event.ids.length}`, durationMs: 100 }); }
function result(k, id) { return k.records.filter(r => r.eventId === id).map(r => r.status) }

test('click burst is batched and each input receives task ownership/result', async () => {
  const { kernel:k, clock:c, shown } = fixture(echo)
  const ids = Array.from({length:5}, () => k.enqueue('click'))
  assert.equal(k.queue.length, 1); await c.advance(100)
  assert.deepEqual(shown, ['click:5']); assert.equal(new Set(k.records.filter(r=>r.status==='running').map(r=>r.taskId)).size,1)
  for (const id of ids) assert.ok(result(k,id).includes('completed'))
})
test('user input outranks ready background work', async () => {
  const {kernel:k,clock:c,shown} = fixture(echo)
  k.enqueue('idle'); k.enqueue('timer'); k.enqueue('click'); k.enqueue('text',{text:'user'})
  await c.advance(100)
  assert.deepEqual(shown, ['user','click:1','timer:1','idle:1'])
})
test('new text aborts running work and rejects late output even if handler ignores abort', async () => {
  let release, stale
  const {kernel:k,clock:c,shown} = fixture(async (e,ctx) => {
    if (e.payload.text==='old') { await new Promise(r=>release=r); stale=await ctx.command('text',{text:'OLD',durationMs:100}) }
    else await echo(e,ctx)
  })
  const old=k.enqueue('text',{text:'old'}); await c.advance(0)
  k.enqueue('text',{text:'new'}); await c.advance(0); release(); await flush()
  assert.deepEqual(shown,['new']); assert.equal(stale.status,'cancelled'); assert.ok(result(k,old).includes('cancelled'))
})
test('pause cancels active task, holds queue, and resume restarts pending work', async () => {
  const {kernel:k,clock:c,shown} = fixture(async(e,ctx)=>{await ctx.sleep(200);await echo(e,ctx)})
  const first=k.enqueue('text',{text:'first'});await c.advance(0);k.pause(true)
  k.enqueue('text',{text:'second'});await c.advance(400);assert.equal(k.state,'paused');assert.deepEqual(shown,[])
  k.pause(false);await c.advance(200);assert.deepEqual(shown,['second']);assert.ok(result(k,first).includes('cancelled'))
})
test('cancel queued input and scheduled timer prevents execution',async()=>{
  const {kernel:k,clock:c,shown}=fixture(echo);k.pause(true)
  const id=k.enqueue('text',{text:'remove'}),timer=k.scheduleTimer(200)
  k.cancel(id);k.cancel(timer);k.pause(false);await c.advance(1000)
  assert.deepEqual(shown,[]);assert.ok(result(k,id).includes('cancelled'));assert.equal(k.timers.size,0)
})
test('quiet mode suppresses small events including every member of a queued batch',async()=>{
  const {kernel:k,clock:c,shown}=fixture(echo)
  const ids=Array.from({length:3},()=>k.enqueue('click'));k.setQuiet(true);k.enqueue('idle');k.enqueue('text',{text:'allowed'})
  await c.advance(100);assert.deepEqual(shown,['allowed']);assert.equal(k.queue.length,0)
  for(const id of ids)assert.ok(result(k,id).includes('cancelled'))
})
test('deadline frees an uncooperative handler; next input recovers error state',async()=>{
  let release
  const {kernel:k,clock:c,shown}=fixture(async(e,ctx)=>{
    if(e.payload.text==='hang'){await new Promise(r=>release=r);await ctx.command('text',{text:'late',durationMs:100})}
    else await echo(e,ctx)
  })
  const id=k.enqueue('text',{text:'hang'});await c.advance(1000)
  assert.equal(k.state,'error');assert.ok(result(k,id).includes('timeout'))
  k.enqueue('text',{text:'recovered'});await c.advance(0);release();await flush()
  assert.deepEqual(shown,['recovered']);assert.equal(k.state,'idle')
})
test('handler failure releases active task and allows another event',async()=>{
  const {kernel:k,clock:c,shown}=fixture(async(e,ctx)=>{if(e.payload.text==='fail')throw Error('fixture secret');await echo(e,ctx)})
  k.enqueue('text',{text:'fail'});await c.advance(0);assert.equal(k.state,'error')
  k.enqueue('text',{text:'ok'});await c.advance(0);assert.deepEqual(shown,['ok'])
  assert.ok(!JSON.stringify(k.snapshot()).includes('fixture secret'))
})
test('body session fences stale begin/command/stop and never advertises unsupported gestures',()=>{
  const shown=[],s=new BodySession({showText:t=>shown.push(t),clearText(){}})
  s.begin({taskId:'new',generation:2})
  assert.equal(s.begin({taskId:'old',generation:1}).status,'cancelled')
  assert.equal(s.stop({taskId:'old',generation:1}).status,'cancelled')
  assert.equal(s.execute({taskId:'old',generation:1,commandId:'a',kind:'text',payload:{text:'old',durationMs:100}}).status,'cancelled')
  assert.equal(s.execute({taskId:'new',generation:2,commandId:'b',kind:'gesture',payload:{name:'wave'}}).status,'unsupported')
  assert.equal(s.execute({taskId:'new',generation:2,commandId:'c',kind:'text',payload:{text:'new',durationMs:100}}).status,'completed')
  s.stop({taskId:'new',generation:2})
  assert.equal(s.execute({taskId:'new',generation:2,commandId:'d',kind:'text',payload:{text:'late',durationMs:100}}).status,'cancelled')
  assert.deepEqual(shown,['new'])
})
test('bounded queue/timers and metadata journal omit user input',async()=>{
  const journal=[],{kernel:k,clock:c}=fixture(echo,{journal:r=>journal.push(r),maxQueue:2})
  k.pause(true);k.enqueue('text',{text:'private-content'});k.enqueue('text',{text:'second'})
  const rejected=k.enqueue('text',{text:'third'});assert.ok(result(k,rejected).includes('rejected'))
  for(let i=0;i<16;i++)k.scheduleTimer(200);assert.throws(()=>k.scheduleTimer(200),/timer limit/)
  assert.throws(()=>k.enqueue('text',{text:'x'.repeat(501)}));assert.throws(()=>k.enqueue('__proto__'))
  assert.ok(!JSON.stringify(k.snapshot()).includes('private-content'));assert.ok(!JSON.stringify(journal).includes('private-content'))
  k.close();await c.advance(2000);assert.equal(k.active,null);assert.equal(k.timers.size,0)
})

test('high priority input interrupts idle, queued batch cancellation preserves other inputs',async()=>{
  const {kernel:k,clock:c,shown}=fixture(async(e,ctx)=>{await ctx.sleep(e.type==='idle'?500:0);await echo(e,ctx)})
  const idle=k.enqueue('idle');await c.advance(100)
  const ids=[k.enqueue('click'),k.enqueue('click')];k.cancel(ids[0]);await c.advance(100)
  assert.ok(result(k,idle).includes('cancelled'));assert.deepEqual(shown,['click:1'])
  assert.ok(result(k,ids[0]).includes('cancelled'));assert.ok(!result(k,ids[0]).includes('completed'))
})
test('unsupported actions return truthful receipt; invalid/mismatched body receipts fail task',async()=>{
  const {kernel:k,clock:c}=fixture(async(e,ctx)=>{
    const receipt=await ctx.command('gaze',{x:0,y:0});assert.equal(receipt.status,'unsupported')
  })
  k.enqueue('text',{text:'unsupported'});await c.advance(0)
  assert.equal(k.state,'idle');assert.ok(k.records.some(r=>r.result==='unsupported'))
  k.handler=echo;k.body.execute=command=>({status:'completed',taskId:'wrong',commandId:command.commandId})
  const id=k.enqueue('text',{text:'bad receipt'});await c.advance(0)
  assert.ok(result(k,id).includes('failed'));assert.equal(k.active,null)
})
test('body failure, invalid text and stop command cannot silently report success',async()=>{
  const {kernel:k,clock:c}=fixture(echo)
  k.body.begin=task=>({status:'failed',taskId:task.taskId})
  const id=k.enqueue('text',{text:'no body'});await c.advance(0);assert.ok(result(k,id).includes('failed'))
  const s=new BodySession({showText(){},clearText(){}});s.begin({taskId:'t',generation:1})
  const cmd={taskId:'t',generation:1,commandId:'c',kind:'text',payload:{text:'x',durationMs:NaN}}
  assert.equal(s.execute(cmd).status,'failed')
  assert.equal(s.execute({...cmd,kind:'stop',payload:{}}).status,'completed')
  assert.equal(s.execute({...cmd,commandId:'late',payload:{text:'late',durationMs:100}}).status,'cancelled')
})

test('bounded background queue makes room for user; repeated resume never lies about active state',async()=>{
  const {kernel:k,clock:c,shown}=fixture(async(e,ctx)=>{await ctx.sleep(100);await echo(e,ctx)},{maxQueue:2})
  k.pause(true);const idle=k.enqueue('idle');k.enqueue('click');k.enqueue('text',{text:'priority'})
  assert.equal(k.queue.length,2);assert.ok(result(k,idle).includes('cancelled'))
  k.pause(false);await c.advance(0);assert.equal(k.state,'thinking');k.pause(false);assert.equal(k.state,'thinking')
  await c.advance(200);assert.equal(shown[0],'priority')
})

import { StageBodyAdapter } from '../source/desktop-v1.1.0/app/kernel/stage-adapter.mjs'
test('unresponsive body RPC has a deadline; adapter forwards only fixed operation names',async()=>{
  const c=new Clock(), calls=[]
  const adapter=new StageBodyAdapter((op,payload)=>{calls.push(op);return new Promise(()=>{})},{timeoutMs:100,clock:c})
  const pending=adapter.capabilities();const rejected=assert.rejects(pending,/body timeout/)
  await c.advance(100);await rejected;assert.equal(c.timers.size,0);assert.deepEqual(calls,['body:capabilities'])
  const unavailable=new StageBodyAdapter(async()=>({ok:false}),{clock:c})
  await assert.rejects(unavailable.begin({taskId:'t',generation:1}),/body unavailable/)
  assert.equal(c.timers.size,0)
})

test('cancelled body receipt cannot become a successful task',async()=>{
  const {kernel:k,clock:c}=fixture(echo)
  k.body.execute=command=>({status:'cancelled',taskId:command.taskId,commandId:command.commandId})
  const id=k.enqueue('text',{text:'cancelled by body'});await c.advance(0)
  assert.ok(result(k,id).includes('cancelled'));assert.ok(!result(k,id).includes('completed'));assert.equal(k.active,null)
})

test('expired task cannot emit before a delayed timeout callback is delivered',async()=>{
  let release
  const {kernel:k,clock:c,shown}=fixture(async(e,ctx)=>{await new Promise(r=>release=r);await ctx.command('text',{text:'expired',durationMs:100})})
  const id=k.enqueue('text',{text:'expired'});await c.advance(0)
  c.time=2000;release();await flush();assert.deepEqual(shown,[])
  await c.advance(0);assert.ok(result(k,id).includes('timeout'))
})

test('clearing stopped work also clears an error state without resuming a task',async()=>{
  const {kernel:k,clock:c}=fixture(async()=>{throw Error('fixture')})
  k.enqueue('text',{text:'failure'});await c.advance(0);assert.equal(k.state,'error')
  k.cancel();assert.equal(k.state,'idle');assert.equal(k.active,null)
})
