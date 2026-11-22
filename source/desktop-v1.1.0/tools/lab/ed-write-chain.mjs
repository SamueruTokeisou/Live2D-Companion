// 编辑台写入链路探针：钩子有没有跑、motionPlaying 有没有挡住、点了竖手指后参数到底写没写进去。
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
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
await page.goto(`${BASE}/app/editor.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
await page.waitForFunction(() => document.querySelectorAll('#lib .chip').length > 2, { timeout: 60000 })
await new Promise((r) => setTimeout(r, 1500))

console.log('STATE0', JSON.stringify(await page.evaluate(() => window.__editor.state())))

// 钩子计数：onBeforeUpdate 到底有没有每帧被调
const hits = await page.evaluate(async () => {
  let n = 0
  const off = window.__editor.stage.onBeforeUpdate(() => { n += 1 })
  await new Promise((r) => setTimeout(r, 500))
  off()
  const ph = window.__editor.stage.physicsInfo()
  return { beforeUpdateCalls: n, physics: ph }
})
console.log('HOOKS', JSON.stringify(hits))

// 点竖手指 → 看 cur / state / 参数
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#lib .chip[data-kind="pose"]')].find((c) => c.dataset.name === '竖手指')
  b?.click()
})
await new Promise((r) => setTimeout(r, 800))
const afterLoad = await page.evaluate(() => ({
  state: window.__editor.state(),
  cur: window.__editor.cur?.name,
  params: window.__editor.cur?.params,
  key0: window.__editor.cur?.keys?.[0]?.values,
  computed: window.__editor.valueAt('Movement3'),
  read: ['Movement1', 'Movement3', 'Param40', 'Param39'].reduce((o, id) => { o[id] = window.__editor.stage.param.get(id); return o }, {}),
}))
console.log('AFTER_LOAD', JSON.stringify(afterLoad, null, 1))

// 盯着参数 1 秒，看是不是「写了又被拍回去」
const watch = await page.evaluate(async () => {
  const st = window.__editor.stage
  const seen = []
  for (let i = 0; i < 10; i++) {
    seen.push(st.param.get('Movement3'))
    await new Promise((r) => setTimeout(r, 100))
  }
  return seen
})
console.log('WATCH_Movement3', JSON.stringify(watch))
await browser.close()
