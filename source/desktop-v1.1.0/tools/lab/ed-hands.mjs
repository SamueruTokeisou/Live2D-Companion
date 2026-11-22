// 编辑台手部动作实测：点姿势 chip 前后，读参数 + 截预览图，判断到底有没有生效。
// 用法：node tools/lab/ed-hands.mjs [url] [token]
import puppeteer from 'puppeteer-core'
import { access, writeFile } from 'node:fs/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:55782'
const TOKEN = process.argv[3] || 'local-app'
const OUT = process.argv[4] || 'tmp/ed-hands'
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const findBrowser = async () => {
  for (const p of BROWSERS) { try { await access(p); return p } catch {} }
  throw new Error('no browser')
}

const browser = await puppeteer.launch({
  executablePath: await findBrowser(),
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERR', e.message))
await page.goto(`${BASE}/app/editor.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForFunction(() => document.querySelectorAll('#lib .chip').length > 2, { timeout: 45000 })
await new Promise((r) => setTimeout(r, 1500))

const shot = async (tag) => {
  const box = await page.evaluate(() => {
    const r = document.querySelector('#preview').getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  })
  const buf = await page.screenshot({ clip: box })
  await writeFile(`${OUT}-${tag}.png`, buf)
  return buf
}

const params = async () => page.evaluate(() => {
  const st = window.__editor?.stage
  if (!st) return null
  const ids = ['Movement1', 'Movement2', 'Movement3', 'Param36', 'Param39', 'Param40', 'Param41', 'Param42', 'Param56', 'Param57', 'Param59', 'Param60', 'Param61', 'Param62']
  const out = {}
  for (const id of ids) out[id] = st.param.get(id)
  return out
})

console.log('CUR', JSON.stringify(await page.evaluate(() => ({ cur: window.__editor?.cur?.name, t: window.__editor?.time }))))
const base = await shot('base')
const p0 = await params()
console.log('P0', JSON.stringify(p0))

// 点「竖手指」姿势 chip
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('#lib .chip[data-kind="pose"]')].find((c) => c.dataset.name === '竖手指')
  if (!b) return null
  b.click()
  return b.dataset.name
})
console.log('CLICK', clicked)
await new Promise((r) => setTimeout(r, 900))
const p1 = await params()
console.log('P1', JSON.stringify(p1))
console.log('CUR2', JSON.stringify(await page.evaluate(() => ({ cur: window.__editor?.cur?.name, params: window.__editor?.cur?.params?.length, keys: window.__editor?.cur?.keys?.length }))))
const after = await shot('finger')
console.log('PIXEL_CHANGED', Buffer.compare(base, after) !== 0)

// 再走一遍「装载后立即把参数写成目标值」的直写路径，看画面变不变
const direct = await page.evaluate(async () => {
  const st = window.__editor.stage
  const before = { ...window.__editor.cur?.keys?.[0]?.values }
  st.param.set('Movement1', 0); st.param.set('Movement3', 1); st.param.set('Param40', 1)
  await new Promise((r) => setTimeout(r, 300))
  return { before, read: st.param.get('Movement3') }
})
console.log('DIRECT', JSON.stringify(direct))
await new Promise((r) => setTimeout(r, 400))
await shot('direct')

// 切到另一个不含手部参数的动作，看会不会残留（串台）
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#lib .chip[data-kind="idle"]')].find((c) => c.dataset.name === '东张西望')
  b?.click()
})
await new Promise((r) => setTimeout(r, 1200))
const p2 = await params()
console.log('P2_AFTER_SWITCH', JSON.stringify(p2))
console.log('CUR3', JSON.stringify(await page.evaluate(() => ({ cur: window.__editor?.cur?.name }))))
await shot('switched')

await browser.close()
