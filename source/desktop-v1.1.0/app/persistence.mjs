// Local settings only. Unique temporary names and synchronous commits prevent
// an older asynchronous save from overwriting the final shutdown snapshot.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须为对象')
  const version = Object.hasOwn(value, 'schemaVersion') ? value.schemaVersion : 0
  if (!Number.isInteger(version) || version < 0 || version > 1) throw new Error('配置版本不受支持')
  return value
}
function parse(file) { return validate(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))) }
function atomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temp, 'wx')
    try { writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temp, file)
  } finally { if (existsSync(temp)) unlinkSync(temp) }
}
export function readSettings(file) {
  if (!existsSync(file) && !existsSync(`${file}.bak`)) return {}
  let value
  try { value = parse(file) } catch (error) {
    // Never downgrade a future version via an older backup.
    let raw
    try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch {}
    if (raw?.schemaVersion > 1) throw new Error('配置来自更新版本，请更新程序')
    try { value = parse(`${file}.bak`) } catch { throw new Error('配置损坏且没有有效备份，请按配置恢复说明处理') }
    const preserved = `${file}.corrupt-${randomUUID()}`
    if (existsSync(file)) renameSync(file, preserved)
    atomic(file, value)
    atomic(`${file}.recovery.json`, { schemaVersion: 1, recovered: true, preserved: path.basename(preserved) })
  }
  if (!value.schemaVersion) {
    atomic(`${file}.bak`, value)
    value = { ...value, schemaVersion: 1 }
    atomic(file, value)
  }
  return value
}
export function writeSettings(file, value) {
  validate(value)
  if (existsSync(file)) atomic(`${file}.bak`, parse(file))
  atomic(file, { ...value, schemaVersion: 1 })
}
