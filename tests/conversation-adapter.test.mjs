import test from 'node:test'
import assert from 'node:assert/strict'
import {audioEnergy,createConversationAdapter} from '../companion/kernel/conversation-adapter.mjs'
function fixture(mode='generic', missing=false) {
 const values={ParamMouthOpenY:0,ParamMouthForm:0,ParamBrowLY:0,MouthSmile_L:0}; const writes=[]; let before,after
 const stage={param:{info:id=>id in values && !(missing&&id==='ParamMouthOpenY')?{min:0,max:1}:null,get:id=>values[id],set:(id,v)=>{assert.ok(v>=0&&v<=1);writes.push(id);values[id]=v}},onBeforeUpdate:fn=>before=fn,afterRender:fn=>after=fn}
 return {adapter:createConversationAdapter(stage,{mode}),values,writes,draw:()=>{before();const frame={...values};after();return frame}}
}
test('actual audio energy is silent at rest and bounded',()=>{assert.equal(audioEnergy(new Float32Array(128)),0);assert.equal(audioEnergy([NaN]),0);assert.equal(audioEnergy([1,-1]),1)})
test('speech opens mouth, restores baseline each frame and stop clears state',()=>{const f=fixture();f.adapter.setFace('speaking');f.adapter.setAudioLevel(.6);for(let i=0;i<100;i++){assert.ok(Math.abs(f.draw().ParamMouthOpenY-.45)<1e-9);assert.equal(f.values.ParamMouthOpenY,0);assert.equal(f.values.ParamMouthForm,0)}assert.ok(!f.writes.includes('MouthSmile_L'));f.adapter.stop();assert.equal(f.draw().ParamMouthOpenY,0);assert.equal(f.adapter.snapshot().phase,'idle')})
test('missing mouth remains safe; dedicated smile only in explicit adapter',()=>{const f=fixture('deepseek',true);f.adapter.setFace('responding');assert.ok(f.draw().MouthSmile_L>0);assert.equal(f.adapter.snapshot().mouthSupported,false);assert.ok(!f.writes.includes('ParamMouthOpenY'))})

import {installBodyPort} from '../companion/kernel/body-port.mjs'
test('bubble expiry restores idle face and stop clears presentation',async t=>{
 const keys=['window','document','setTimeout','clearTimeout','cancelAnimationFrame'];const old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));t.after(()=>{for(const[k,v]of old)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k]})
 let expire,phase='idle',visible=false
 globalThis.window={addEventListener(){}};globalThis.document={createElement:()=>({style:{},remove(){visible=false}}),body:{append(){visible=true}},querySelector:()=>null};globalThis.setTimeout=fn=>(expire=fn,1);globalThis.clearTimeout=()=>{};globalThis.cancelAnimationFrame=()=>{}
 const adapter={setFace:p=>phase=p,stop:()=>phase='idle',snapshot:()=>({phase})}
 const body=installBodyPort({get:async()=>({bubble:true})},adapter);await Promise.resolve()
 body.begin({taskId:'t',generation:1});assert.equal(phase,'thinking');body.execute({taskId:'t',generation:1,commandId:'a',kind:'text',payload:{text:'你好',durationMs:500}});assert.ok(visible);assert.equal(phase,'responding');expire();assert.ok(!visible);assert.equal(phase,'idle')
 body.stop({taskId:'t',generation:1});assert.equal(phase,'idle');assert.equal(window.__companionBody('snapshot').audioState,'idle')
})
test('cancel during asynchronous audio preparation cannot create or play late audio',async t=>{
 const keys=['window','document','cancelAnimationFrame','fetch','Audio'];const old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));t.after(()=>{for(const[k,v]of old)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k]})
 globalThis.window={addEventListener(){}};globalThis.document={querySelector:()=>null};globalThis.cancelAnimationFrame=()=>{}
 let resolveFetch,created=0;globalThis.fetch=()=>new Promise(resolve=>resolveFetch=resolve);globalThis.Audio=class {constructor(){created++}}
 const body=installBodyPort({get:async()=>({bubble:true})});body.begin({taskId:'old',generation:1})
 const pending=body.execute({taskId:'old',generation:1,commandId:'a',kind:'audio',payload:{wav:'Zm9v',volume:.7}});await Promise.resolve();assert.ok(resolveFetch)
 body.stop({taskId:'old',generation:1});resolveFetch({blob:async()=>new Blob(['fixture'])});assert.equal((await pending).status,'cancelled');assert.equal(created,0);assert.equal(window.__companionBody('snapshot').audioState,'idle')
})
test('voice disabled stays cold; enabling prepares audio once before playback',async t=>{
 const keys=['window','document','AudioContext'];const old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));t.after(()=>{for(const[k,v]of old)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k]})
 let created=0,settingsChanged;globalThis.window={addEventListener(){}};globalThis.document={querySelector:()=>null};globalThis.AudioContext=class{constructor(){created++}resume(){return Promise.resolve()}}
 installBodyPort({get:async()=>({bubble:true,voiceEnabled:false}),onSettings:fn=>settingsChanged=fn},{snapshot:()=>({})});await Promise.resolve();assert.equal(created,0)
 settingsChanged({bubble:true,voiceEnabled:true});settingsChanged({bubble:true,voiceEnabled:true});assert.equal(created,1);assert.equal(window.__companionBody('snapshot').audioPrepared,true)
})
