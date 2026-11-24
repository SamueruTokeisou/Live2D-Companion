import { randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { realpath } from 'node:fs/promises'

export const createControlToken = () => randomBytes(32).toString('base64url')
export function equalToken(value, token) {
  return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token))
}
export function isWithin(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file))
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
}
export async function safeRealFile(root, file) {
  if (!isWithin(root, file)) return false
  try { return isWithin(await realpath(root), await realpath(file)) } catch { return false }
}
export function trustedRequest(req, port) {
  const authority = `127.0.0.1:${port}`, origin = 'http://' + authority
  if (req.headers.host !== authority) return false
  if (req.headers.origin !== undefined && req.headers.origin !== origin) return false
  if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return false
  try { return req.url?.startsWith('/') && new URL(req.url, origin).origin === origin } catch { return false }
}
const RUNTIME_RPC = new Set(['meta', 'catalog', 'regions', 'local:ping', 'local:health', 'local:visibility', 'local:quit', 'local:settings', 'local:chat', 'local:kernel',
  'chat:snapshot', 'chat:enable', 'chat:send', 'chat:stop', 'chat:clear', 'chat:voice', 'chat:volume', 'chat:voice-status',
  'kernel:snapshot', 'kernel:capabilities', 'kernel:enable', 'kernel:event', 'kernel:cancel', 'kernel:pause', 'kernel:quiet', 'kernel:timer',
  'body:snapshot', 'body:capabilities'])
export const allowedRpc = (op, development = false) => typeof op === 'string' && (RUNTIME_RPC.has(op) || development)
