// 编辑台验收：启用列表 / 手型基底 / 切动作复位 / 待机 14s 表情是否自己变 / 点热区演反应
import puppeteer from 'puppeteer-core'
import { access, writeFile } from 'node:fs/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:60357'
const TOKEN = process.argv[3] || 'local-app'
const OUT = 'tmp/ed-on'
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

const box = await page.evaluate(() => {
  const r = document.querySelector('#preview').getBoundingClientRect()
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
})
const snap = async (tag) => {
  const buf = await page.screenshot({ clip: box })
  await writeFile(`${OUT}-${tag}.png`, buf)
  return buf
}
const baseShot = await snap('base')

// ① 启用列表
await page.evaluate(() => document.querySelector('#src-tabs button[data-src="on"]').click())
await new Promise((r) => setTimeout(r, 500))
const onPane = await page.evaluate(() => ({
  preview: document.querySelector('#on-preview')?.textContent?.replace(/\s+/g, ' ').slice(0, 220),
  stage: document.querySelector('#on-stage')?.textContent?.replace(/\s+/g, ' ').slice(0, 180),
  rx: document.querySelector('#on-reactions')?.textContent?.replace(/\s+/g, ' ').slice(0, 160),
}))
console.log('ENABLED', JSON.stringify(onPane, null, 1))

// 采样器：挂在编辑台写入之后（beforeModelUpdate 里最后注册 = 最后执行），读到的是真正进渲染的值
const installSampler = () => page.evaluate(() => {
  window.__samples = []
  const ids = ['Movement1', 'Movement3', 'Param40', 'MouthSmile_L', 'TongueOut', 'ParamEyeLOpen']
  window.__stopSample = window.__editor.stage.onBeforeUpdate(() => {
    const st = window.__editor.stage
    const row = {}
    for (const id of ids) row[id] = +(+st.param.get(id)).toFixed(3)
    window.__samples.push(row)
    if (window.__samples.length > 400) window.__samples.shift()
  })
})
const readSamples = (n = 6) => page.evaluate((k) => (window.__samples || []).slice(-k), n)

await page.evaluate(() => document.querySelector('#src-tabs button[data-src="lib"]').click())
await installSampler()

// ② 装载带手型的预设「指人」：base 应该补回来、手应该抬
await page.evaluate(() => [...document.querySelectorAll('#lib .chip')].find((c) => c.dataset.name === '指人')?.click())
await new Promise((r) => setTimeout(r, 1200))
const zhiren = await page.evaluate(() => ({
  cur: window.__editor.cur?.name,
  base: Object.keys(window.__editor.cur?.base || {}).length,
  holds: Object.keys(window.__editor.cur?.holds || {}).length,
  params: window.__editor.cur?.params?.length,
}))
const zhirenShot = await snap('zhiren')
console.log('ZHI_REN', JSON.stringify(zhiren), 'changed', Buffer.compare(baseShot, zhirenShot) !== 0)
console.log('SAMPLE_ZHI_REN', JSON.stringify(await readSamples(3)))

// ③ 切到不带手型的「东张西望」：手要放下来（复位），参数回默认
await page.evaluate(() => [...document.querySelectorAll('#lib .chip')].find((c) => c.dataset.name === '东张西望')?.click())
await new Promise((r) => setTimeout(r, 1200))
console.log('AFTER_SWITCH', JSON.stringify(await page.evaluate(() => ({ cur: window.__editor.cur?.name, base: Object.keys(window.__editor.cur?.base || {}).length }))))
console.log('SAMPLE_SWITCH', JSON.stringify(await readSamples(3)))
const switchShot = await snap('switched')

// ④ 待机 14s：不碰任何东西，看表情参数会不会自己变（引擎 IDLE 抢参数的话这里会跳）
const before = await readSamples(4)
await page.evaluate(() => { window.__samples = [] })
await new Promise((r) => setTimeout(r, 14000))
const idle = await readSamples(400)
let jumped = 0
for (let i = 1; i < idle.length; i++) {
  for (const k of Object.keys(idle[i])) if (Math.abs(idle[i][k] - idle[i - 1][k]) > 0.05) jumped += 1
}
const exprVals = new Set(idle.map((r) => `${r.MouthSmile_L}/${r.TongueOut}/${r.ParamEyeLOpen}`))
console.log('IDLE14S', JSON.stringify({ frames: idle.length, jumps: jumped, distinctExprStates: exprVals.size, sample: [...exprVals].slice(0, 4) }))

// ⑤ 点热区（启用页 → 反应表名字）：演一遍并记录
await page.evaluate(() => document.querySelector('#src-tabs button[data-src="on"]').click())
await new Promise((r) => setTimeout(r, 300))
const picked = await page.evaluate(() => {
  const row = [...document.querySelectorAll('#on-reactions .dline')].find((d) => d.querySelector('b')?.textContent?.trim() === '胸')
  row?.click()
  return row ? row.textContent.replace(/\s+/g, ' ') : null
})
await new Promise((r) => setTimeout(r, 600))
const touch = await page.evaluate(() => ({
  diag: document.querySelector('#diag')?.textContent?.replace(/\s+/g, ' ').slice(0, 160),
  exprs: window.__editor.state().exprs,
}))
console.log('REGION_TAP', JSON.stringify({ picked, ...touch }, null, 1))
await snap('tap-chest')

console.log('ERRORS', JSON.stringify(errs.slice(0, 5)))
await browser.close()
