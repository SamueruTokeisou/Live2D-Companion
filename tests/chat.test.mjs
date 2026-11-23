import test from 'node:test'
import assert from 'node:assert/strict'
import { CodexProvider, ChatError, PROCESS_CONFIG } from '../source/desktop-v1.1.0/app/kernel/codex-provider.mjs'
import { ChatRuntime } from '../source/desktop-v1.1.0/app/kernel/chat-runtime.mjs'

class FakeTransport {
  constructor(scenario) { this.scenario=scenario;this.listeners=new Set();this.requests=[];this.closed=false }
  async initialize() {}
  onEvent(fn) {this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  emit(method,params={}) {for(const fn of this.listeners)fn({method,params})}
  send(message) {this.sent=message}
  close() {this.closed=true}
  async request(method,params) {
    this.requests.push({method,params})
    if(method==='account/read')return{account:{type:'chatgpt'}}
    if(method==='config/read')return{config:{mcp_servers:{fixture:{enabled:true}}}}
    if(method==='model/list')return{data:[{model:'fixture-model',isDefault:true}]}
    if(method==='thread/start')return{thread:{id:'thread-fixture',ephemeral:true},sandbox:{type:'readOnly'},approvalPolicy:'never'}
    if(method==='turn/start'){queueMicrotask(()=>this.scenario(this));return{turn:{id:'turn-fixture'}}}
  }
}
const completed=t=>{
  t.emit('turn/started',{threadId:'thread-fixture',turn:{id:'turn-fixture'}})
  t.emit('item/agentMessage/delta',{threadId:'thread-fixture',delta:'你'})
  t.emit('item/agentMessage/delta',{threadId:'thread-fixture',delta:'好'})
  t.emit('thread/tokenUsage/updated',{threadId:'thread-fixture',tokenUsage:{last:{inputTokens:4,outputTokens:2,totalTokens:6}}})
  t.emit('turn/completed',{threadId:'thread-fixture',turn:{status:'completed'}})
}
function providerFixture(scenario=completed,options={}){
  const transport=new FakeTransport(scenario),provider=new CodexProvider({cwd:'unused',transportFactory:()=>transport,...options})
  return{transport,provider}
}
test('Codex protocol streams text, collects real-shaped usage, disables configured MCP and uses ephemeral read-only sessions',async()=>{
  const {transport:t,provider:p}=providerFixture(),deltas=[]
  const result=await p.stream({messages:[{role:'user',content:'fixture'}],signal:new AbortController().signal,onDelta:x=>deltas.push(x)})
  assert.deepEqual(deltas,['你','你好']);assert.equal(result.text,'你好');assert.equal(result.usage.totalTokens,6);assert.equal(t.closed,true)
  const thread=t.requests.find(r=>r.method==='thread/start').params
  assert.equal(thread.ephemeral,true);assert.equal(thread.sandbox,'read-only');assert.equal(thread.config.mcp_servers.fixture.enabled,false)
  assert.equal(PROCESS_CONFIG['features.shell_tool'],false);assert.equal(PROCESS_CONFIG['features.hooks'],false);assert.deepEqual(PROCESS_CONFIG.notify,[])
})
test('output cap returns limited output and unknown usage rather than inventing tokens',async()=>{
  const {provider:p,transport:t}=providerFixture(t=>t.emit('item/agentMessage/delta',{threadId:'thread-fixture',delta:'x'.repeat(900)}))
  const result=await p.stream({messages:[],signal:new AbortController().signal})
  assert.equal(result.text.length,500);assert.equal(result.limited,true);assert.equal(result.usage,null);assert.equal(t.closed,true)
})
test('unsupported tool event is rejected and connection closed',async()=>{
  const {provider:p,transport:t}=providerFixture(t=>t.emit('item/started',{threadId:'thread-fixture',item:{type:'commandExecution'}}))
  await assert.rejects(p.stream({messages:[],signal:new AbortController().signal}),e=>e.code==='tool_denied');assert.equal(t.closed,true)
})
test('abort closes owned connection and late deltas cannot return',async()=>{
  const {provider:p,transport:t}=providerFixture(()=>{}),controller=new AbortController(),deltas=[]
  const pending=p.stream({messages:[],signal:controller.signal,onDelta:x=>deltas.push(x)}),rejection=assert.rejects(pending,e=>e.code==='cancelled')
  for(let i=0;i<20;i++)await Promise.resolve()
  controller.abort();await rejection;t.emit('item/agentMessage/delta',{threadId:'thread-fixture',delta:'late'})
  assert.deepEqual(deltas,[]);assert.equal(t.closed,true)
})
test('hung generation has finite deadline',async()=>{
  const {provider:p,transport:t}=providerFixture(()=>{},{timeoutMs:20})
  await assert.rejects(p.stream({messages:[],signal:new AbortController().signal}),e=>e.code==='request_timeout');assert.equal(t.closed,true)
})
test('unexpected exit reports backend failure without waiting the full deadline',async()=>{
  const {provider:p}=providerFixture(t=>t.emit('companion/closed',{code:'native-detail'}))
  await assert.rejects(p.stream({messages:[],signal:new AbortController().signal}),e=>e.code==='backend_unavailable')
})
test('missing auth, non-ephemeral or non-read-only sessions never start a model turn',async()=>{
  for(const kind of ['auth','ephemeral','permissions']){
    const {provider:p,transport:t}=providerFixture();const original=t.request.bind(t)
    t.request=async(method,params)=>{
      if(kind==='auth'&&method==='account/read')return{account:null}
      if(method==='thread/start'&&kind!=='auth'){const result=await original(method,params);if(kind==='ephemeral')result.thread.ephemeral=false;else result.sandbox.type='dangerFullAccess';return result}
      return original(method,params)
    }
    await assert.rejects(p.stream({messages:[],signal:new AbortController().signal}))
    assert.ok(!t.requests.some(r=>r.method==='turn/start'))
  }
})
function runtimeFixture(provider,options={}){
  const kernel={records:[],aiConnected:false,sequence:0,enqueue(){const id='e'+ ++this.sequence;this.records.push({eventId:id,status:'queued'});return id},cancel(){}}
  const runtime=new ChatRuntime({kernel,provider,now:()=>100,...options}),commands=[]
  const controller=new AbortController()
  const ctx={taskId:'t',signal:controller.signal,isCurrent:()=>!controller.signal.aborted,command:async(kind,payload)=>{commands.push({kind,payload});return{status:'completed'}},sleep:async()=>{}}
  return{runtime,kernel,ctx,controller,commands}
}
const fakeProvider={async stream({onDelta}){onDelta('你');onDelta('你好');return{text:'你好',model:'fixture',usage:{inputTokens:4,outputTokens:2},limited:false}}}
test('runtime bounds recent context, streams only text and accumulates known usage',async()=>{
  const lengths=[],provider={async stream(args){lengths.push(args.messages.length);return fakeProvider.stream(args)}}
  const{runtime:r,ctx,commands}=runtimeFixture(provider)
  for(let i=0;i<5;i++){const text='round'+i,id=r.send(text);await r.handle({id,type:'text',payload:{text}},ctx)}
  assert.equal(r.history.length,6);assert.ok(Math.max(...lengths)<=7);assert.equal(r.snapshot().usage.knownInputTokens,20);assert.ok(commands.every(c=>c.kind==='text'))
})
test('failure is visible and sanitized; no fabricated fallback reply or context entry',async()=>{
  const{runtime:r,ctx}=runtimeFixture({async stream(){throw Error('fixture-private-error')}})
  const id=r.send('fixture')
  await assert.rejects(r.handle({id,type:'text',payload:{text:'fixture'}},ctx))
  assert.equal(r.history.length,0);assert.equal(r.entries.at(-1).status,'failed');assert.ok(!JSON.stringify(r.snapshot()).includes('fixture-private-error'));assert.equal(r.snapshot().usage.unknownUsageRounds,1)
})
test('local rate limit is bounded, no automatic retry, and clearing context does not reset it',async()=>{
  let calls=0;const{runtime:r,ctx}=runtimeFixture({async stream(args){calls++;return fakeProvider.stream(args)}},{maxPerMinute:1})
  const id=r.send('one');await r.handle({id,type:'text',payload:{text:'one'}},ctx);r.clear()
  const second=r.send('two');await assert.rejects(r.handle({id:second,type:'text',payload:{text:'two'}},ctx),e=>e.code==='local_limit')
  assert.equal(calls,1);assert.equal(r.snapshot().usage.appRequests,1);assert.equal(r.snapshot().usage.unknownUsageRounds,0)
})
test('cancelled uncooperative provider cannot append late text or restore recent context',async()=>{
  let release,delta
  const{runtime:r,ctx,controller,commands}=runtimeFixture({async stream({onDelta}){delta=onDelta;await new Promise(resolve=>release=resolve);onDelta('late');return{text:'late',usage:null}}})
  const id=r.send('cancel'),pending=r.handle({id,type:'text',payload:{text:'cancel'}},ctx),rejected=assert.rejects(pending)
  controller.abort();delta('ignored');release();await rejected
  assert.equal(r.history.length,0);assert.equal(r.entries.at(-1).text,'');assert.deepEqual(commands,[]);assert.equal(r.entries.at(-1).status,'cancelled')
})
test('background click never invokes cloud provider',async()=>{
  let called=false;const{runtime:r,ctx}=runtimeFixture({async stream(){called=true}})
  await r.handle({id:'click',type:'click',ids:['click'],payload:{}},ctx)
  assert.equal(called,false);assert.equal(r.snapshot().usage.appRequests,0)
})

import { findCodex } from '../source/desktop-v1.1.0/app/kernel/codex-provider.mjs'
import path from 'node:path'
test('explicit missing executable fails closed instead of using another available provider',()=>{
  assert.throws(()=>findCodex({LIVE2D_CODEX_PATH:path.resolve('fixture-no-codex.exe'),PATH:process.env.PATH}),e=>e.code==='codex_missing')
})
