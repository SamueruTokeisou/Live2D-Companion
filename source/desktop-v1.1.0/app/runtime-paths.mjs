/** Keep profile settings separate from the one encryption context used by shared accounts. */
import path from 'node:path'
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs'
export function configureRuntimePaths(app, {profileHome,authHome,legacyCryptoHome}={}) {
 const home=path.resolve(profileHome || app.getPath('userData'))
 mkdirSync(home,{recursive:true})
 if (!authHome) {app.setPath('userData',home);return home}
 const browserHome=path.join(path.resolve(authHome),'browser-state')
 mkdirSync(browserHome,{recursive:true})
 const state=path.join(browserHome,'Local State')
 if (!existsSync(state) && existsSync(path.join(authHome,'accounts.json'))) {
  // Copy only the OS-protected key, never decrypted credentials. Never overwrite an existing key.
  const old=legacyCryptoHome && path.join(legacyCryptoHome,'Local State')
  if (!old || !existsSync(old)) throw new Error('Shared account encryption context is missing; existing credentials were preserved')
  const crypt=JSON.parse(readFileSync(old,'utf8')).os_crypt
  if (typeof crypt?.encrypted_key!=='string' || !crypt.encrypted_key) throw new Error('Legacy encryption context is invalid')
  writeFileSync(state,JSON.stringify({os_crypt:{ encrypted_key:crypt.encrypted_key, audit_enabled:crypt.audit_enabled === true }}),{flag:'wx'})
 }
 app.setPath('userData',browserHome)
 app.setPath('sessionData',browserHome)
 return home
}

/** A damaged account context must not prevent the offline desktop from starting. */
export function resolveRuntimePaths(app, options = {}) {
 try { return {home:configureRuntimePaths(app,options),authError:false} }
 catch {
  const home=configureRuntimePaths(app,{profileHome:options.profileHome})
  app.setPath('sessionData',home)
  return {home,authError:true}
 }
}

