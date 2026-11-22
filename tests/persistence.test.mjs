import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSettings, writeSettings } from '../source/desktop-v1.1.0/app/persistence.mjs'

test('settings migration, burst saves, backup recovery and future-version protection', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'companion-config-'))
  const file = path.join(dir, 'settings.json')
  try {
    writeFileSync(file, JSON.stringify({ zoom: 0.6, unknown: { keep: true } }))
    assert.equal(readSettings(file).schemaVersion, 1)
    for (let i = 0; i < 40; i++) writeSettings(file, { ...readSettings(file), zoom: i })
    assert.equal(readSettings(file).zoom, 39)
    writeFileSync(file, '{broken')
    assert.equal(readSettings(file).zoom, 38)
    assert.ok(readdirSync(dir).some(n => n.includes('.corrupt-')))
    assert.deepEqual(readSettings(file).unknown, { keep: true })
    unlinkSync(file)
    assert.equal(readSettings(file).zoom, 38)
    writeFileSync(file, '{"schemaVersion":9}')
    assert.throws(() => readSettings(file), /更新版本/)
    assert.equal(JSON.parse(readFileSync(file)).schemaVersion, 9)
    writeFileSync(file, '{broken')
    writeFileSync(file + '.bak', '{broken')
    assert.throws(() => readSettings(file), /损坏/)
    assert.equal(readFileSync(file, 'utf8'), '{broken')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

import { visiblePosition } from '../source/desktop-v1.1.0/app/placement.mjs'
test('placement preserves visible windows and recovers absent screens', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -1600, y: 0, width: 1600, height: 900 }]
  assert.deepEqual(visiblePosition({ x: -1200, y: 40, width: 380, height: 620 }, areas), { x: -1200, y: 40 })
  assert.deepEqual(visiblePosition({ x: 99999, y: 99999, width: 380, height: 620 }, areas), { x: 1540, y: 460 })
  assert.deepEqual(visiblePosition({ x: -1200, y: 40, width: 380, height: 620 }, [areas[0]]), { x: 0, y: 40 })
  assert.deepEqual(visiblePosition({ x: 99999, y: 99999, width: 4000, height: 2000 }, [areas[0]]), { x: 0, y: 0 })
})
