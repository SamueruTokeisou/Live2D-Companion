// 同一帧内的写入诊断：在 beforeModelUpdate 里写 Movement3，然后在钩子末尾 / 帧后各读一次。
import puppeteer from 'puppeteer-core'
import { access } from 'node:fs/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:61261'
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
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERR', e.message))
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 200)))
await page.goto(`${BASE}/app/editor.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
await page.waitForFunction(() => document.querySelectorAll('#lib .chip').length > 2, { timeout: 60000 })
await new Promise((r) => setTimeout(r, 1200))

const out = await page.evaluate(async () => {
  const st = window.__editor.stage
  const log = []
  const off = st.onBeforeUpdate(() => {
    st.param.set('Movement3', 1)
    log.push({ at: 'inHook', v: st.param.get('Movement3') })
  })
  await new Promise((r) => setTimeout(r, 350))
  off()
  // 钩子外（帧间）读一次
  log.push({ at: 'betweenFrames', v: st.param.get('Movement3') })
  // 直接写，立刻读
  st.param.set('Movement3', 0.77)
  log.push({ at: 'direct', v: st.param.get('Movement3') })
  await new Promise((r) => setTimeout(r, 300))
  log.push({ at: 'after300ms', v: st.param.get('Movement3') })
  return log
})
console.log('LOG', JSON.stringify(out, null, 1))
await browser.close()
