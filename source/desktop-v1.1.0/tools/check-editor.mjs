// 编辑台 Smoke：加载 → 动作库渲染 → 装载内置动作 → 交互/热区/诊断
import puppeteer from 'puppeteer-core'
import { access } from 'node:fs/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:56081'
const TOKEN = process.argv[3] || 'local-app'
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
const findBrowser = async () => {
  for (const p of BROWSERS) { try { await access(p); return p } catch {} }
  throw new Error('找不到 Edge/Chrome')
}

const browser = await puppeteer.launch({
  executablePath: await findBrowser(),
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(`${BASE}/app/editor.html?token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForFunction(() => document.querySelectorAll('#lib .chip').length > 2, { timeout: 45000 })
await new Promise((r) => setTimeout(r, 1200))

const info = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  groups: [...document.querySelectorAll('#lib .lib-group h4')].map((h) => h.textContent.trim().slice(0, 14)),
  chips: document.querySelectorAll('#lib .chip').length,
  mine: document.querySelectorAll('#act-list li').length,
  diag: document.querySelector('#diag')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120),
  canvas: !!document.querySelector('#preview canvas'),
}))
console.log('INFO', JSON.stringify(info, null, 2))

// 装载一个内置待机动作（第一组第一个 chip）
await page.click('#lib .lib-group .chip')
await new Promise((r) => setTimeout(r, 500))
const loaded = await page.evaluate(() => ({
  cur: window.__editor?.cur?.name,
  holds: Object.keys(window.__editor?.cur?.holds || {}),
  keys: window.__editor?.cur?.keys?.length,
  tab: document.querySelector('#src-tabs button.on')?.textContent,
}))
console.log('LOADED', JSON.stringify(loaded))

// 打开热区 + 交互，看诊断是否更新
await page.click('#v-regions')
await page.click('#v-interact')
await new Promise((r) => setTimeout(r, 400))
const after = await page.evaluate(() => ({
  diag: document.querySelector('#diag')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 140),
  overlay: !!document.querySelector('#region-overlay'),
}))
console.log('AFTER', JSON.stringify(after))

// 官方动作：切回动作库，点第一个官方 chip，播放中诊断应显示「官方动作播放中」
await page.click('#src-tabs button[data-src="lib"]')
const motionSel = '#lib .chip[data-kind="motion"]'
await page.click(motionSel)
await new Promise((r) => setTimeout(r, 700))
const motion = await page.evaluate(() => ({
  diag: document.querySelector('#diag')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 90),
  err: null,
}))
console.log('MOTION', JSON.stringify(motion))

// 表情：点一下应高亮
await page.click('#lib .chip[data-kind="expr"]')
await new Promise((r) => setTimeout(r, 300))
const expr = await page.evaluate(() => ({
  on: document.querySelector('#lib .chip[data-kind="expr"]')?.classList.contains('on'),
}))
console.log('EXPR', JSON.stringify(expr))

// 热区：点选后应在预览里画出高亮；点预览中心应命中某个热区
await page.click('#lib .chip[data-kind="region"]')
const box = await page.evaluate(() => {
  const r = document.querySelector('#preview').getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.42 }
})
await page.mouse.click(box.x, box.y)
await new Promise((r) => setTimeout(r, 400))
const region = await page.evaluate(() => ({
  hit: window.__editor?.hit?.() ?? null,
  diag: document.querySelector('#diag')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120),
}))
console.log('REGION', JSON.stringify(region))

// 旧存档里的「护胯」应已清掉
const noCrotch = await page.evaluate(() => ![...document.querySelectorAll('#act-list li')].some((li) => li.textContent.includes('护胯')))
console.log('NO_CROTCH', noCrotch)

// 中键拖动 = 平移预览；左键点击不再带走画面
const viewBefore = await page.evaluate(() => window.__editor.view)
const c = await page.evaluate(() => {
  const r = document.querySelector('#preview').getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.move(c.x, c.y)
await page.mouse.down({ button: 'middle' })
await page.mouse.move(c.x + 90, c.y + 40, { steps: 5 })
await page.mouse.up({ button: 'middle' })
await new Promise((r) => setTimeout(r, 200))
const viewAfter = await page.evaluate(() => window.__editor.view)
console.log('PAN', JSON.stringify({ before: viewBefore, after: viewAfter }))

// 动作含头部角度 → 交互追踪暂停
await page.evaluate(() => { window.__editor.stage; })
await page.click('#src-tabs button[data-src="lib"]')
const idleChip = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('#lib .chip[data-kind="idle"]')].find((c) => c.dataset.name === '东张西望')
  hit?.click()
  return hit?.dataset.name || null
})
await new Promise((r) => setTimeout(r, 500))
const headYield = await page.evaluate(() => ({
  loaded: window.__editor.cur?.name,
  diag: document.querySelector('#diag')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120),
}))
console.log('HEAD_YIELD', JSON.stringify({ idleChip, ...headYield }))

// 数值框：点数字改值 → 当前关键帧与滑条同步
await page.click('#src-tabs button[data-src="mine"]')
await page.click('#param-list li')
await new Promise((r) => setTimeout(r, 250))
const num = await page.$('.pa .num')
if (num) {
  const id = await page.evaluate(() => document.querySelector('.pa .num')?.dataset.num)
  const before = await page.evaluate((id) => window.__editor.valueAt(id), id)
  await num.click({ clickCount: 3 })
  await page.keyboard.type('0.321')
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 250))
  const after = await page.evaluate((id) => ({
    v: window.__editor.valueAt(id),
    shown: document.querySelector('.pa .num')?.value,
    range: document.querySelector('.pa input[type=range]')?.value,
  }), id)
  console.log('NUMERIC', JSON.stringify({ id, before, after }))
} else console.log('NUMERIC', 'no .num input')

await page.screenshot({ path: 'tmp/editor-merged.png' })
console.log('ERRORS', errors.length ? errors.slice(0, 8) : 'none')
console.log('SHOT tmp/editor-merged.png')
await browser.close()
