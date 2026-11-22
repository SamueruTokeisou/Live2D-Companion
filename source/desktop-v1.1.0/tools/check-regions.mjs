// 编辑台热区对齐检查：同体型下，本地重铺的身体段应包住角色（而不是框到空气）
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] || 'http://127.0.0.1:56696'
const TOKEN = process.argv[3] || 'local-app'
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
let exe = BROWSERS[0]
const { access } = await import('node:fs/promises')
for (const p of BROWSERS) { try { await access(p); exe = p; break } catch {} }

const b = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'], defaultViewport: { width: 1440, height: 900 } })
const page = await b.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto(`${BASE}/app/editor.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForFunction(() => document.querySelectorAll('#lib .chip').length > 2, { timeout: 45000 })
await new Promise((r) => setTimeout(r, 1500))
await page.click('#v-regions')
await new Promise((r) => setTimeout(r, 500))

const info = await page.evaluate(() => {
  const regions = window.__editor.regions ? window.__editor.regions() : null
  const st = window.__editor.stage
  const ms = st.modelSize()
  return {
    ms: { w: ms.width, h: ms.height },
    names: regions ? regions.map((r) => r.name) : null,
    head: regions?.find((r) => r.name === '头')?.points,
    chest: regions?.find((r) => r.name === '胸')?.points,
  }
})
console.log('REGIONS', JSON.stringify(info).slice(0, 600))
await page.screenshot({ path: 'tmp/editor-regions.png' })
console.log('ERRORS', errs.length ? errs.slice(0, 5) : 'none')
await b.close()
