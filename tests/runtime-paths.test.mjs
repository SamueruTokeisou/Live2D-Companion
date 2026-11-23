import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {configureRuntimePaths,resolveRuntimePaths} from '../source/desktop-v1.1.0/app/runtime-paths.mjs'
import {ProtectedAccountStore} from '../source/desktop-v1.1.0/app/kernel/chatgpt-auth.mjs'
function fixture(t){
 const root=mkdtempSync(path.join(tmpdir(),'companion-paths-'));const profile=path.join(root,'role'),auth=path.join(root,'auth'),legacy=path.join(root,'legacy');for(const d of [profile,auth,legacy])mkdirSync(d)
 const state=path.join(auth,'browser-state','Local State'),accounts=path.join(auth,'accounts.json'),old=path.join(legacy,'Local State');const paths={};const app={getPath:()=>profile,setPath:(key,value)=>paths[key]=value}
 t.after(()=>{for(const f of [state,accounts,old])if(existsSync(f))unlinkSync(f);for(const d of [path.dirname(state),profile,auth,legacy,root])if(existsSync(d))rmdirSync(d)})
 return {root,profile,auth,legacy,state,accounts,old,paths,app,run:()=>configureRuntimePaths(app,{profileHome:profile,authHome:auth,legacyCryptoHome:legacy})}
}
test('shared encryption context preserves legacy credentials and separates profile settings',t=>{const f=fixture(t);writeFileSync(f.accounts,'encrypted-account-fixture');writeFileSync(f.old,JSON.stringify({os_crypt:{encrypted_key:'protected-key-fixture',audit_enabled:true},private_browser_data:'must-not-copy'}));assert.equal(f.run(),f.profile);assert.equal(f.paths.userData,path.join(f.auth,'browser-state'));assert.equal(f.paths.sessionData,f.paths.userData);assert.deepEqual(JSON.parse(readFileSync(f.state)),{os_crypt:{encrypted_key:'protected-key-fixture',audit_enabled:true}});assert.equal(readFileSync(f.accounts,'utf8'),'encrypted-account-fixture');assert.ok(readFileSync(f.old,'utf8').includes('must-not-copy'))})
test('new installation creates a shared context without needing legacy files',t=>{const f=fixture(t);f.run();assert.ok(existsSync(path.dirname(f.state)));assert.ok(!existsSync(f.state))})
test('existing encryption context is never replaced on a later character switch',t=>{const f=fixture(t);mkdirSync(path.dirname(f.state));writeFileSync(f.state,'existing-context');writeFileSync(f.accounts,'existing-accounts');f.run();assert.equal(readFileSync(f.state,'utf8'),'existing-context')})
test('missing migration key fails without changing account records',t=>{const f=fixture(t);writeFileSync(f.accounts,'preserve-me');assert.throws(f.run,/missing/);assert.equal(readFileSync(f.accounts,'utf8'),'preserve-me');assert.ok(!existsSync(f.state))})
test('decrypt failure is explicit and never overwrites the encrypted account',t=>{const f=fixture(t);const content=JSON.stringify({schemaVersion:1,encrypted:Buffer.from('ciphertext-fixture').toString('base64')});writeFileSync(f.accounts,content);const store=new ProtectedAccountStore(f.auth,{isEncryptionAvailable:()=>true,decryptString(){throw new Error('private decrypt details')}});assert.throws(()=>store.read(),{code:'credentials_unreadable'});assert.equal(readFileSync(f.accounts,'utf8'),content)})

test('missing key preserves offline startup while blocking shared authentication',t=>{const f=fixture(t);writeFileSync(f.accounts,'preserve-me');const result=resolveRuntimePaths(f.app,{profileHome:f.profile,authHome:f.auth});assert.equal(result.home,f.profile);assert.equal(result.authError,true);assert.equal(f.paths.userData,f.profile);assert.equal(f.paths.sessionData,f.profile);assert.equal(readFileSync(f.accounts,'utf8'),'preserve-me')})
