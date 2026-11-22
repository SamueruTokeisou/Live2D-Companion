// 对比「指人」和「竖手指」这两个预设到底写了哪些参数，找出把头发/脸写没的那个。
import puppeteer from 'puppeteer-core'
import { access } from 'node:fs/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:60357'
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
page.on('pageerror', (e) => console.log('PAGEERR', e.message))
await page.goto(`${BASE}/app/editor.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
await page.waitForFunction(() => document.querySelectorAll('#lib .chip').length > 2, { timeout: 60000 })
await new Promise((r) => setTimeout(r, 1500))

const dump = async (name) => {
  const d = await page.evaluate((n) => {
    const chip = [...document.querySelectorAll('#lib .chip')].find((c) => c.dataset.name === n)
    chip?.click()
    const cur = window.__editor.cur
    const k0 = cur?.keys?.[0]?.values || {}
    return {
      name: cur?.name,
      preset: cur?.preset,
      base: cur?.base || null,
      holds: cur?.holds || null,
      key0: k0,
      params: cur?.params || [],
    }
  }, name)
  await new Promise((r) => setTimeout(r, 700))
  return d
}

const zhi = await dump('指人')
const shu = await dump('竖手指')
console.log('指人', JSON.stringify(zhi, null, 1))
console.log('竖手指', JSON.stringify(shu, null, 1))
const onlyZhi = Object.keys(zhi.key0).filter((k) => !(k in shu.key0))
const onlyShu = Object.keys(shu.key0).filter((k) => !(k in zhi.key0))
console.log('ONLY_ZHI', JSON.stringify(onlyZhi), 'ONLY_SHU', JSON.stringify(onlyShu))
await browser.close()
