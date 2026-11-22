// 编辑台启用页 + 预览点按反应 验收
import puppeteer from 'puppeteer-core'
import { access, writeFile } from 'node:fs/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:51500'
const TOKEN = process.argv[3] || 'local-app'
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
  defaultViewport: { width: 1440, height: 1200, deviceScaleFactor: 1 },
})
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => { errs.push(e.message); console.log('PAGEERR', e.message) })
page.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text()); console.log('CONSOLE', m.text().slice(0, 160)) } })
await page.goto(`${BASE}/app/editor.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
await page.waitForFunction(() => document.querySelectorAll('#lib .chip').length > 2, { timeout: 60000 })
await new Promise((r) => setTimeout(r, 1600))

await page.evaluate(() => document.querySelector('#src-tabs button[data-src="on"]').click())
await new Promise((r) => setTimeout(r, 600))
console.log('ON_STAGE', JSON.stringify(await page.evaluate(() => document.querySelector('#on-stage')?.textContent?.replace(/\s+/g, ' ').trim())))
console.log('ON_PREVIEW', JSON.stringify(await page.evaluate(() => document.querySelector('#on-preview')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200))))

// 点预览里的头：应该命中「头」并按反应表切「爱心眼」
await page.evaluate(() => document.querySelector('#src-tabs button[data-src="lib"]').click())
const box = await page.evaluate(() => {
  const r = document.querySelector('#preview').getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
})
await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.2)
await new Promise((r) => setTimeout(r, 700))
console.log('TAP_HEAD', JSON.stringify(await page.evaluate(() => ({
  hit: window.__editor.hit?.()?.name ?? null,
  diag: document.querySelector('#diag')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 180),
  exprs: window.__editor.state().exprs, flash: window.__editor.state().flash,
}))))

// 拖动 = 抚摸：从胸往下扫
await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.36)
await page.mouse.down()
await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.45, { steps: 8 })
await page.mouse.up()
await new Promise((r) => setTimeout(r, 700))
console.log('PET_DRAG', JSON.stringify(await page.evaluate(() => ({
  diag: document.querySelector('#diag')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 180),
  exprs: window.__editor.state().exprs, flash: window.__editor.state().flash,
}))))

// 设置页有随机小表情开关
const settings = await browser.newPage()
await settings.goto(`${BASE}/app/settings.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
const has = await settings.evaluate(() => !!document.querySelector('#random-faces')).catch(() => null)
console.log('SETTINGS_CHECKBOX', JSON.stringify(has))
console.log('ERRORS', JSON.stringify(errs.slice(0, 6)))
await browser.close()
