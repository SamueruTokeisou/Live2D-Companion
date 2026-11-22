// 编辑台：四个姿势 + 若干待机预设逐个装载，截图对比，找出「哪个手型不出来」。
import puppeteer from 'puppeteer-core'
import { access, writeFile } from 'node:fs/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:61261'
const TOKEN = process.argv[3] || 'local-app'
const OUT = 'tmp/ed-pose'
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

const box = await page.evaluate(() => {
  const r = document.querySelector('#preview').getBoundingClientRect()
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
})

// 预设清单概况
const all = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('#lib .lib-group')].map((g) => ({
    title: g.querySelector('h4')?.textContent?.replace(/\s+/g, ' ').trim(),
    chips: [...g.querySelectorAll('.chip')].map((c) => `${c.dataset.kind}:${c.dataset.name}`),
  }))
  return groups
})
console.log('GROUPS', JSON.stringify(all, null, 1))

const snap = async (tag) => {
  const buf = await page.screenshot({ clip: box })
  await writeFile(`${OUT}-${tag}.png`, buf)
  return buf
}

const paramsOf = () => page.evaluate(() => {
  const ids = ['Movement1', 'Movement2', 'Movement3', 'Param36', 'Param39', 'Param40', 'Param41', 'Param42', 'Param56', 'Param57', 'Param59', 'Param60', 'Param61', 'Param62']
  const st = window.__editor.stage
  const o = {}
  for (const id of ids) o[id] = +(+st.param.get(id)).toFixed(3)
  return o
})

const base = await snap('base')
const baseP = await paramsOf()
console.log('BASE', JSON.stringify(baseP))

const poses = ['默认手', '竖手指', '举手', '狗尾草']
for (const name of poses) {
  await page.evaluate((n) => {
    const b = [...document.querySelectorAll('#lib .chip[data-kind="pose"]')].find((c) => c.dataset.name === n)
    b?.click()
  }, name)
  await new Promise((r) => setTimeout(r, 800))
  const p = await paramsOf()
  const shot = await snap(`pose-${name}`)
  console.log('POSE', name, JSON.stringify({ changed: Buffer.compare(base, shot) !== 0, params: p, cur: await page.evaluate(() => window.__editor.cur?.name) }))
}

// 切到一个不含手部参数的待机动作，看手会不会「粘住」（串台）
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#lib .chip[data-kind="idle"]')].find((c) => c.dataset.name === '东张西望')
  b?.click()
})
await new Promise((r) => setTimeout(r, 1500))
console.log('AFTER_IDLE', JSON.stringify({ cur: await page.evaluate(() => window.__editor.cur?.name), params: await paramsOf() }))
await snap('after-idle')

await browser.close()
