import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { ChatGptAuth, validateIdentity, ProtectedAccountStore } from '../source/desktop-v1.1.0/app/kernel/chatgpt-auth.mjs'
import { ChatGptProvider } from '../source/desktop-v1.1.0/app/kernel/chatgpt-provider.mjs'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig' }
const scopes = 'resource.invoke chatgpt.tokens.use.direct'
function jwt(claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'account-test', exp: Date.now()/1000 + 3600, ...claims })).toString('base64url')
  return header + '.' + body + '.' + sign('RSA-SHA256', Buffer.from(header + '.' + body), privateKey).toString('base64url')
}
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
function setup(options = {}) {
  let saved = null, opened, tokenRequests = []
  const auth = new ChatGptAuth({ store: { read: () => saved, write: data => { saved = structuredClone(data) } }, openExternal: url => { opened = new URL(url) }, fetchImpl: async (url, init) => {
    if (url.endsWith('/jwks.json')) return json({ keys: [jwk] })
    tokenRequests.push(init.body)
    return json({ access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'Bearer', expires_in: 3600, scope: options.scope ?? scopes, id_token: jwt({ nonce: opened.searchParams.get('nonce') }) })
  } })
  return { auth, get opened() { return opened }, tokenRequests, get saved() { return saved } }
}
async function login(s) {
  await s.auth.start()
  const callback = new URL(s.opened.searchParams.get('redirect_uri'))
  callback.search = new URLSearchParams({ code: 'test-code', state: s.opened.searchParams.get('state'), client_id: 'oaiapp_test' })
  const response = await fetch(callback); assert.equal(response.status, 200); await response.text()
}
test('OAuth callback validates state, issued client, PKCE and signed identity; snapshots omit credentials', async t => {
  const s = setup(); t.after(() => s.auth.cancel()); await s.auth.start()
  const bad = new URL(s.opened.searchParams.get('redirect_uri')); bad.search = 'state=invalid&code=x&client_id=oaiapp_test'
  assert.equal((await fetch(bad)).status, 400); assert.equal(s.tokenRequests.length, 0)
  const host = s.saved.hostId
  await login(s)
  assert.equal(s.tokenRequests[0].get('client_id'), 'oaiapp_test')
  assert.equal(createHash('sha256').update(s.tokenRequests[0].get('code_verifier')).digest('base64url'), s.opened.searchParams.get('code_challenge'))
  assert.equal(s.saved.hostId, host)
  assert.equal(s.auth.snapshot().needsWelcome, true)
  await assert.rejects(s.auth.token(), { code: 'welcome_required' })
  s.auth.acknowledge(); assert.equal(await s.auth.token(), 'test-access')
  assert.doesNotMatch(JSON.stringify(s.auth.snapshot()), /test-access|test-refresh|idToken|hostId/)
})
test('denied authorization closes attempt without exchanging tokens', async t => {
  const s = setup(); t.after(() => s.auth.cancel()); await s.auth.start()
  const url = new URL(s.opened.searchParams.get('redirect_uri')); url.search = new URLSearchParams({ state: s.opened.searchParams.get('state'), error: 'access_denied' })
  await fetch(url); assert.equal(s.tokenRequests.length, 0); assert.equal(s.auth.snapshot().lastError, 'consent_declined')
})
test('identity signature, nonce, audience, issuer and expiry are required', async () => {
  const options = { clientId: 'oaiapp_test', nonce: 'nonce', fetchImpl: async () => json({ keys: [jwk] }) }
  for (const claims of [{ nonce: 'wrong' }, { nonce: 'nonce', aud: 'other' }, { nonce: 'nonce', iss: 'other' }, { nonce: 'nonce', exp: 1 }]) await assert.rejects(validateIdentity(jwt(claims), options), { code: 'identity_invalid' })
  await assert.rejects(validateIdentity(jwt({ nonce: 'nonce' }).slice(0, -10), options), { code: 'identity_invalid' })
})
test('identity-only login cannot invoke plan or list models', async t => {
  const s = setup({ scope: 'openid profile' }); t.after(() => s.auth.cancel()); await login(s)
  assert.equal(s.auth.snapshot().signedIn, true); assert.equal(s.auth.snapshot().planEnabled, false)
  await assert.rejects(s.auth.token(), { code: 'plan_permission_required' })
})
test('refresh rotates once, retains omitted scope and cannot restore a signed-out session', async t => {
  const s = setup(); t.after(() => s.auth.cancel()); await login(s); s.auth.acknowledge(); s.auth.selected().expiresAt = 0
  let calls = 0, finish
  s.auth.fetch = async () => { calls++; return json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600 }) }
  await Promise.all([s.auth.token(), s.auth.token()]); assert.equal(calls, 1); assert.equal(await s.auth.token(), 'rotated-access')
  s.auth.selected().expiresAt = 0
  s.auth.fetch = async url => url.endsWith('/revoke') ? new Response('', { status: 200 }) : new Promise(resolve => { finish = resolve })
  const pending = s.auth.token(); const checked = assert.rejects(pending, { code: 'account_changed' })
  await s.auth.signOut(); finish(json({ access_token: 'late-access', refresh_token: 'late-refresh', token_type: 'Bearer', expires_in: 3600 }))
  await checked; assert.equal(s.auth.snapshot().signedIn, false); assert.equal(s.saved.accounts[0].accessToken, undefined)
})
test('safe storage fails closed without OS encryption', () => {
  const store = new ProtectedAccountStore('unused', { isEncryptionAvailable: () => false })
  assert.throws(() => store.read(), { code: 'secure_storage_unavailable' }); assert.throws(() => store.write({}), { code: 'secure_storage_unavailable' })
})
function provider(events, options = {}) {
  const requests = []
  const p = new ChatGptProvider({ auth: { token: async () => 'fake-oauth' }, fetchImpl: async (url, init) => {
    requests.push({ url, ...init })
    if (url.endsWith('/models')) return json({ models: [{ slug: 'hidden', display_name: 'Hidden', visibility: 'hide' }, { slug: 'test-model', display_name: 'Test model', visibility: 'list' }] })
    if (options.httpStatus) return new Response(JSON.stringify({ error: { code: options.code } }), { status: options.httpStatus })
    const bytes = new TextEncoder().encode(events.map(e => 'data: ' + JSON.stringify(e) + '\r\n\r\n').join(''))
    return new Response(new ReadableStream({ start(controller) { for (let i=0;i<bytes.length;i++) controller.enqueue(bytes.slice(i,i+1)); controller.close() } }))
  } })
  return { p, requests }
}
const delta = text => ({ type: 'response.output_text.delta', delta: text })
const completed = { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } }
test('direct SSE handles split UTF8/CRLF, account models, exact request fields and completed usage', async () => {
  const { p, requests } = provider([delta('你好'), delta('！'), completed]); const chunks = []
  const result = await p.stream({ messages: [{ role: 'user', content: '你好' }], onDelta: text => chunks.push(text) })
  assert.equal(result.text, '你好！'); assert.deepEqual(chunks, ['你好', '你好！']); assert.equal(result.usage.totalTokens, 15)
  const body = JSON.parse(requests[1].body); assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.model, 'test-model')
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'store', 'stream'])
  assert.match(body.instructions, /只使用自然、简短的日语/)
  assert.match(body.instructions, /不附中文翻译/)
  assert.match(body.instructions, /不扮演任何动漫角色/)
  assert.equal(p.models.length, 1); assert.equal(requests[1].url, 'https://api.openai.com/v1/responses')
})
test('partial, late quota failures and output cap are not successful conversations', async () => {
  for (const [events, code] of [[[delta('partial')], 'incomplete_response'], [[delta('partial'), { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }], 'plan_limit'], [[delta('x'.repeat(501)), completed], 'output_limit']]) {
    const { p } = provider(events); await assert.rejects(p.stream({ messages: [], onDelta() {} }), { code })
  }
})
test('unauthorized and unavailable plan fail without retry or billing fallback', async () => {
  for (const [status, code] of [[401, 'signin_required'], [403, 'plan_permission_required'], [429, 'plan_limit']]) {
    const { p, requests } = provider([], { httpStatus: status }); await assert.rejects(p.stream({ messages: [], onDelta() {} }), { code }); assert.equal(requests.length, 2)
  }
})
test('direct provider cancellation aborts its stream and never reports completion', async () => {
  const controller = new AbortController(); let closed = false
  const p = new ChatGptProvider({ auth: { token: async () => 'fake' }, fetchImpl: async (url, init) => new Response(new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"部分"}\n\n'))
    init.signal.addEventListener('abort', () => { closed = true; c.error(new DOMException('Abort', 'AbortError')) }, { once: true })
  } })) })
  p.models = [{ slug: 'test', displayName: 'test' }]; p.model = 'test'
  await assert.rejects(p.stream({ messages: [], signal: controller.signal, onDelta() { controller.abort() } }), { code: 'cancelled' })
  assert.equal(closed, true)
})
