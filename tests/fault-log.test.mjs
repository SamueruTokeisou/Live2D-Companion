import test from 'node:test'
import assert from 'node:assert/strict'
import {createFaultLog} from '../source/desktop-v1.1.0/src/stage/fault-log.js'
test('stall diagnostics stay bounded and retain frame/audio context without suppressing stalls',t=>{
 let activeLog; const keys=['window','document','PerformanceObserver'];const old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));t.after(()=>{activeLog?.destroy();for(const[k,v]of old)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k]})
 let callback,disconnected=false,clock=0;globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.document={hidden:false};globalThis.PerformanceObserver=class{static supportedEntryTypes=['longtask'];constructor(fn){callback=fn}observe(){}disconnect(){disconnected=true}}
 const sent=[];const log=createFaultLog({limit:2,now:()=>clock,context:()=>({audioState:'playing',frameCostMs:18}),send:(kind,detail)=>sent.push({kind,...detail})});activeLog=log;clock=9000;log.frameGap(9000);callback({getEntries:()=>Array.from({length:20},()=>({startTime:9050,duration:80}))});clock=9200;log.frameGap(9200);assert.equal(sent[0].kind,'frame:stall');assert.equal(sent[0].gapMs,200);assert.equal(sent[0].audioState,'playing');assert.equal(sent[0].recentLongTasksMs.length,8);log.push('fixture');log.push('fixture');assert.equal(log.list().length,2);log.destroy();assert.ok(disconnected)
})
