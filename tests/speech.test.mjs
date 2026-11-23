import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalSpeech } from '../source/desktop-v1.1.0/app/kernel/local-speech.mjs'
import { BodySession } from '../source/desktop-v1.1.0/app/kernel/body-port.mjs'

function speech(fetchImpl) {
  const instance = new LocalSpeech({ configFile: '', fetchImpl })
  instance.config = () => ({ reference: 'test-fixture', promptText: 'reference text', volume: 0, textLanguage: 'zh', promptLanguage: 'zh' })
  return instance
}
const wav = Buffer.from('RIFF0000WAVEtest-fixture')
function context() {
  const controller = new AbortController(), commands = []
  return { controller, commands, signal: controller.signal, isCurrent: () => !controller.signal.aborted, taskId: 'task',
    command: async (kind, payload) => { commands.push({ kind, payload }); return { status: 'completed' } },
    speechState: async () => ({ taskId: 'task', closed: false, audioState: 'ended' }), sleep: async () => {} }
}
test('local Chinese speech waits for observed playback end', async () => {
  let request
  const instance = speech(async (url, init) => { request = { url, ...init }; return new Response(wav) })
  const ctx = context()
  assert.equal(await instance.speak('test', ctx), true)
  assert.equal(request.url, 'http://127.0.0.1:9880/tts')
  assert.equal(request.redirect, 'error')
  const body = JSON.parse(request.body)
  assert.equal(body.text_lang, 'zh'); assert.equal(body.prompt_lang, 'zh'); assert.equal(body.batch_size, 1)
  assert.equal(ctx.commands[0].kind, 'audio'); assert.equal(ctx.commands[0].payload.volume, 0)
  assert.doesNotMatch(JSON.stringify(instance.snapshot()), /test-fixture|reference text/)
})
test('missing configuration never calls speech service', async () => {
  const instance = speech(() => { throw Error('must not run') }); instance.config = () => null
  assert.equal(await instance.speak('test', context()), false)
})
test('invalid speech falls back to text and silences audio', async () => {
  const instance = speech(async () => new Response('invalid')), ctx = context()
  assert.equal(await instance.speak('test', ctx), false)
  assert.ok(instance.snapshot().lastError)
  assert.deepEqual(ctx.commands.map(c => c.kind), ['audio-stop'])
})
test('late synthesis after cancellation cannot start audio', async () => {
  let finish
  const instance = speech(() => new Promise(resolve => { finish = resolve })), ctx = context()
  const pending = instance.speak('test', ctx); ctx.controller.abort(); finish(new Response(wav))
  assert.equal(await pending, false); assert.equal(ctx.commands.length, 0)
})
test('a cancelled but unfinished synthesis cannot overlap a new synthesis', async () => {
  let finish, calls = 0
  const instance = speech(() => { calls++; return new Promise(resolve => { finish = resolve }) }), ctx = context()
  const pending = instance.speak('first', ctx); ctx.controller.abort()
  assert.equal(await instance.speak('second', context()), false)
  assert.equal(calls, 1)
  finish(new Response(wav)); await pending
  assert.equal(instance.busy, false)
})
test('timed-out synthesis cannot silently overlap another backend request', async () => {
  let calls = 0
  const instance = speech((url, init) => {
    calls++
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  })
  instance.timeoutMs = 5
  const keepAlive = setTimeout(() => {}, 100)
  try {
    assert.equal(await instance.speak('first', context()), false)
    assert.equal(await instance.speak('second', context()), false)
    assert.equal(calls, 1)
  } finally { clearTimeout(keepAlive) }
})
test('body cancellation fences deferred playback and stops owned audio', async () => {
  let plays = 0, stops = 0
  const port = new BodySession({ clearText() {}, showText() {}, capabilities: ['audio', 'audio-stop', 'stop'], stopAudio() { stops++ }, async playAudio() { plays++ } })
  port.begin({ taskId: 'old', generation: 1 })
  const pending = port.execute({ taskId: 'old', generation: 1, commandId: 'old/1', kind: 'audio', payload: { wav: 'test', volume: 1 } })
  port.stop({ taskId: 'old', generation: 1 }); port.begin({ taskId: 'new', generation: 2 })
  assert.equal((await pending).status, 'cancelled'); assert.equal(plays, 0); assert.equal(stops, 3)
  assert.equal((await port.execute({ taskId: 'new', generation: 2, commandId: 'new/1', kind: 'audio', payload: { wav: 'test', volume: 2 } })).status, 'failed')
})
