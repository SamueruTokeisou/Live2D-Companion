import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {createControlToken,equalToken,isWithin,trustedRequest,allowedRpc} from '../source/desktop-v1.1.0/src/server/control-security.mjs'
test('launch credentials are random and compare exactly',()=>{const a=createControlToken(),b=createControlToken();assert.equal(a.length,43);assert.notEqual(a,b);assert.ok(equalToken(a,a));assert.ok(!equalToken('local-app',a));assert.ok(!equalToken(b,a))})
test('directory siblings and escapes are denied',()=>{const root=path.resolve('fixture');assert.ok(isWithin(root,path.join(root,'model.json')));assert.ok(!isWithin(root,root+'-private/secret'));assert.ok(!isWithin(root,path.join(root,'../secret')))})
test('native and same-origin clients work, foreign websites and hosts fail',()=>{const req={url:'/api/stage',headers:{host:'127.0.0.1:1234'}};assert.ok(trustedRequest(req,1234));assert.ok(trustedRequest({...req,headers:{...req.headers,origin:'http://127.0.0.1:1234'}},1234));for(const extra of [{host:'evil.test:1234'},{origin:'https://evil.test'},{'sec-fetch-site':'cross-site'},{origin:'null'}])assert.ok(!trustedRequest({...req,headers:{...req.headers,...extra}},1234));assert.ok(!trustedRequest({...req,url:'//evil.test/api'},1234))})
test('normal network control cannot execute body commands or development probes',()=>{for(const op of ['meta','chat:send','body:snapshot','kernel:capabilities'])assert.ok(allowedRpc(op));for(const op of ['body:execute','eval','probe','params'])assert.ok(!allowedRpc(op));assert.ok(allowedRpc('probe',true))})
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {createStageServer} from '../source/desktop-v1.1.0/src/server/stage-server.mjs'
test('real HTTP server enforces authentication and operation boundary',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'companion-control-')); const model=path.join(root,'fixture.model3.json');await writeFile(model,JSON.stringify({FileReferences:{}}));const outside=root+'-secret';await writeFile(outside,'fixture-only');const token=createControlToken();let server
 try {
  server=await createStageServer({root,model,token,integrationDir:root,stageRpc:async op=>({ok:true,value:op})})
  const request=(op,headers={})=>fetch(server.url+'/api/stage/'+op,{method:'POST',headers,body:'{}'})
  assert.equal((await fetch(server.url+'/m/fixture.model3.json')).status,200)
  assert.equal((await fetch(server.url+'/m/%2e%2e%2f'+path.basename(outside))).status,403)
  assert.equal((await request('meta')).status,401)
  assert.equal((await request('meta',{'X-Stage-Token':token,Origin:'https://example.org'})).status,403)
  assert.equal((await request('body:execute',{'X-Stage-Token':token})).status,403)
  const valid=await request('meta',{'X-Stage-Token':token});assert.equal(valid.status,200);assert.equal((await valid.json()).value,'meta')
 } finally {if(server)await server.close();await unlink(model);await unlink(outside);await rmdir(root)}
})
