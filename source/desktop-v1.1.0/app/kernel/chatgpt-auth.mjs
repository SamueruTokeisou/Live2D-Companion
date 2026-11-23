import { createServer } from 'node:http'
import { randomBytes, randomUUID, createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { readSettings, writeSettings } from '../persistence.mjs'
import { ChatError } from './chat-errors.mjs'

const ORIGIN = 'https://auth.openai.com'
const RESOURCE = 'https://api.openai.com/v1'
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const permitted = account => account?.scopes?.includes('chatgpt.tokens.use.direct') && account.scopes.includes('resource.invoke')
const opaque = () => randomBytes(32).toString('base64url')
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export class ProtectedAccountStore {
  constructor(directory, cryptoStorage) { this.file = path.join(directory, 'accounts.json'); this.crypto = cryptoStorage }
  read() {
    if (!this.crypto.isEncryptionAvailable()) throw new ChatError('secure_storage_unavailable')
    const raw = readSettings(this.file)
    return raw.encrypted ? JSON.parse(this.crypto.decryptString(Buffer.from(raw.encrypted, 'base64'))) : null
  }
  write(data) {
    if (!this.crypto.isEncryptionAvailable()) throw new ChatError('secure_storage_unavailable')
    writeSettings(this.file, { schemaVersion: 1, encrypted: this.crypto.encryptString(JSON.stringify(data)).toString('base64') })
  }
}
export async function validateIdentity(token, { clientId, nonce, subject, fetchImpl = fetch, now = Date.now() }) {
  try {
    const [head, body, signature, extra] = token.split('.')
    if (!head || !body || !signature || extra) throw Error()
    const header = JSON.parse(Buffer.from(head, 'base64url')), claims = JSON.parse(Buffer.from(body, 'base64url'))
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw Error()
    const response = await fetchImpl(ORIGIN + '/.well-known/jwks.json', { signal: AbortSignal.timeout(15000), redirect: 'error' })
    if (!response.ok) throw Error()
    const keys = await response.json(), jwk = keys.keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'))
    if (!jwk || !verify('RSA-SHA256', Buffer.from(head + '.' + body), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'))) throw Error()
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (claims.iss !== ORIGIN || !audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId)) throw Error()
    if (typeof claims.exp !== 'number' || claims.exp <= now / 1000 || (claims.iat && claims.iat > now / 1000 + 60)) throw Error()
    if (typeof claims.sub !== 'string' || !claims.sub || (subject && claims.sub !== subject) || (nonce && !equal(claims.nonce, nonce))) throw Error()
    return { subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : null }
  } catch { throw new ChatError('identity_invalid') }
}
export class ChatGptAuth {
  constructor({ store, openExternal, fetchImpl = fetch, now = () => Date.now() }) {
    this.store = store; this.openExternal = openExternal; this.fetch = fetchImpl; this.now = now
    this.data = store.read() || { hostId: 'urn:uuid:' + randomUUID(), accounts: [], selected: null, pendingClient: null }
    if (!this.data.hostId?.startsWith('urn:uuid:') || !Array.isArray(this.data.accounts)) throw new ChatError('credentials_invalid')
    store.write(this.data) // Host ID persists before first authorization.
    this.epoch = 0; this.pending = null; this.refreshing = null; this.lastError = null; this.lastNotice = null
  }
  selected() { return this.data.accounts.find(a => a.id === this.data.selected) || null }
  snapshot() {
    const active = this.selected()
    return { pending: !!this.pending, lastError: this.lastError, notice: this.lastNotice,
      selected: active?.id || null, signedIn: !!active?.accessToken, planEnabled: !!active?.accessToken && !!permitted(active),
      needsWelcome: !!active?.accessToken && !!permitted(active) && !active.welcomeSeen,
      accounts: this.data.accounts.map(a => ({ id: a.id, label: `${a.email || 'ChatGPT 账号'} · ${a.clientId.slice(-6)}`, signedIn: !!a.accessToken, planEnabled: !!a.accessToken && !!permitted(a) })) }
  }
  save() { this.store.write(this.data) }
  cancel() {
    const attempt = this.pending
    this.pending = null
    if (attempt) { clearTimeout(attempt.timer); attempt.controller.abort(); attempt.server.close() }
  }
  async start({ newAccount = false } = {}) {
    this.cancel(); this.epoch++; this.lastError = null; this.lastNotice = null
    const active = newAccount ? null : this.selected()
    const clientId = active?.clientId || (!newAccount && this.data.pendingClient) || 'dynamic_agent_client'
    const attempt = { state: opaque(), nonce: opaque(), verifier: randomBytes(48).toString('base64url'), controller: new AbortController(), clientId, expectedSubject: active?.subject, accountId: active?.id, consumed: false }
    const server = createServer((req, res) => { this.callback(req, res, attempt).catch(() => { if (!res.writableEnded) res.end('Sign-in could not be completed. Return to the companion.'); this.fail(attempt, 'signin_failed') }) })
    attempt.server = server
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    attempt.redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`
    this.pending = attempt
    attempt.timer = setTimeout(() => this.fail(attempt, 'signin_timeout'), 300000)
    const url = new URL(ORIGIN + '/api/accounts/authorize')
    const params = { client_id: clientId, ext_agent_host_id: this.data.hostId, response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE,
      state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') }
    if (clientId === 'dynamic_agent_client') params.agent_name_hint = 'Live2D Companion'
    if (active && !permitted(active)) params.prompt = 'consent'
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    try { await this.openExternal(url.href) } catch { this.fail(attempt, 'browser_open_failed'); throw new ChatError('browser_open_failed') }
  }
  fail(attempt, code) { if (this.pending === attempt) { this.lastError = code; this.cancel() } }
  async callback(req, res, attempt) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Referrer-Policy', 'no-referrer')
    const url = new URL(req.url, attempt.redirectUri)
    if (req.method !== 'GET' || url.pathname !== '/auth/callback') { res.statusCode = 404; res.end('Not found'); return }
    if (this.pending !== attempt || attempt.consumed || url.searchParams.getAll('state').length !== 1 || !equal(url.searchParams.get('state'), attempt.state)) { res.statusCode = 400; res.end('Invalid sign-in state'); return }
    attempt.consumed = true
    if (url.searchParams.has('error')) { res.end('Authorization was not granted. Return to the companion.'); this.fail(attempt, 'consent_declined'); return }
    const code = url.searchParams.get('code'), issued = url.searchParams.get('client_id')
    if (!code || url.searchParams.getAll('code').length !== 1 || (issued && !/^[A-Za-z0-9_-]{4,256}$/.test(issued))) throw Error()
    const clientId = attempt.clientId === 'dynamic_agent_client' ? issued : attempt.clientId
    if (!clientId || clientId === 'dynamic_agent_client' || (issued && issued !== clientId)) throw Error()
    if (!attempt.accountId) { this.data.pendingClient = clientId; this.save() }
    const tokens = await this.tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE }, attempt.controller.signal)
    const identity = await validateIdentity(tokens.id_token, { clientId, nonce: attempt.nonce, subject: attempt.expectedSubject, fetchImpl: this.fetch, now: this.now() })
    if (this.pending !== attempt || attempt.controller.signal.aborted) throw Error()
    const prior = this.data.accounts.find(a => a.clientId === clientId && a.subject === identity.subject)
    const account = { id: prior?.id || randomUUID(), clientId, ...identity, welcomeSeen: prior?.welcomeSeen || false, ...this.tokenFields(tokens) }
    this.data.accounts = this.data.accounts.filter(a => a.id !== account.id); this.data.accounts.push(account); this.data.selected = account.id; this.data.pendingClient = null
    this.save(); res.end('登录完成，请返回桌宠。首次授权后，在桌宠中确认使用 ChatGPT 套餐。'); this.cancel()
  }
  tokenFields(tokens) {
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new ChatError('token_invalid')
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, idToken: tokens.id_token || null, expiresAt: this.now() + tokens.expires_in * 1000,
      scopes: typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/).filter(Boolean) : [] }
  }
  async tokenRequest(values, signal) {
    const response = await this.fetch(ORIGIN + '/api/accounts/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
    if (!response.ok) throw new ChatError(response.status === 400 || response.status === 401 ? 'signin_required' : 'auth_unavailable')
    return response.json()
  }
  select(id) {
    if (!this.data.accounts.some(a => a.id === id)) throw new ChatError('account_invalid')
    this.cancel(); this.epoch++; this.data.selected = id; this.lastError = null; this.save()
  }
  acknowledge() { const account = this.selected(); if (account && permitted(account)) { account.welcomeSeen = true; this.save() } }
  async token() {
    if (this.pending) throw new ChatError('signin_pending')
    const account = this.selected()
    if (!account?.accessToken) throw new ChatError('signin_required')
    if (!permitted(account)) throw new ChatError('plan_permission_required')
    if (!account.welcomeSeen) throw new ChatError('welcome_required')
    if (account.expiresAt > this.now() + 60000) return account.accessToken
    if (!this.refreshing) this.refreshing = this.refresh(account).finally(() => { this.refreshing = null })
    await this.refreshing
    if (this.selected()?.id !== account.id) throw new ChatError('account_changed')
    if (!permitted(account)) throw new ChatError('plan_permission_required')
    return account.accessToken
  }
  async refresh(account) {
    if (!account.refreshToken) throw new ChatError('signin_required')
    const epoch = this.epoch
    const tokens = await this.tokenRequest({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource: RESOURCE })
    if (tokens.id_token) await validateIdentity(tokens.id_token, { clientId: account.clientId, subject: account.subject, fetchImpl: this.fetch, now: this.now() })
    if (!tokens.refresh_token) throw new ChatError('token_invalid')
    if (epoch !== this.epoch || !account.refreshToken) throw new ChatError('account_changed')
    Object.assign(account, this.tokenFields({ ...tokens, scope: tokens.scope ?? account.scopes.join(' '), id_token: tokens.id_token || account.idToken })); this.save()
  }
  async signOut() {
    this.cancel(); this.epoch++; const account = this.selected(); if (!account) return
    const refreshToken = account.refreshToken
    for (const key of ['accessToken', 'refreshToken', 'idToken', 'expiresAt', 'scopes']) delete account[key]
    this.save(); this.save() // Clear both atomic backup generations before network revocation.
    let revoked = !refreshToken
    if (refreshToken) {
      try {
        const response = await this.fetch(ORIGIN + '/api/accounts/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }), signal: AbortSignal.timeout(15000), redirect: 'error' })
        revoked = response.ok
      } catch {}
    }
    for (const key of ['accessToken', 'refreshToken', 'idToken', 'expiresAt', 'scopes']) delete account[key]
    this.lastNotice = revoked ? 'signed_out' : 'revocation_unconfirmed'; this.save()
  }
}
