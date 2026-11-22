// 编辑台：带手型的待机动作 / 官方 motion3 播放，逐张截图看手。
import puppeteer from 'puppeteer-core'
import { access, writeFile } from 'node:fs/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:61261'
const TOKEN = process.argv[3] || 'local-app'
const OUT = 'tmp/ed-rx'
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
const snap = async (tag) => {
  const buf = await page.screenshot({ clip: box })
  await writeFile(`${OUT}-${tag}.png`, buf)
  return buf
}
const base = await snap('base')

const load = async (name) => {
  await page.evaluate((n) => {
    const b = [...document.querySelectorAll('#lib .chip')].find((c) => c.dataset.name === n)
    b?.click()
  }, name)
  await new Promise((r) => setTimeout(r, 900))
  const cur = await page.evaluate(() => ({ name: window.__editor.cur?.name, params: window.__editor.cur?.params?.length, base: !!window.__editor.cur?.base, holds: !!window.__editor.cur?.holds }))
  const shot = await snap(`r-${name}`)
  return { cur, changed: Buffer.compare(base, shot) !== 0 }
}

for (const n of ['挥挥手', '挥手打招呼', '指人', '杂鱼晃手', '护胸防御']) {
  console.log('ROUTINE', n, JSON.stringify(await load(n)))
}

// 官方动作：挑名字里像挥手/举手的试播
const motions = await page.evaluate(() => [...document.querySelectorAll('#lib .chip[data-kind="motion"]')].map((c) => c.dataset.name))
console.log('MOTIONS', JSON.stringify(motions))
for (const n of motions.slice(0, 4)) {
  await page.evaluate((nm) => {
    const b = [...document.querySelectorAll('#lib .chip[data-kind="motion"]')].find((c) => c.dataset.name === nm)
    b?.click()
  }, n)
  await new Promise((r) => setTimeout(r, 700))
  await snap(`m-${n}`)
  console.log('MOTION', n, JSON.stringify(await page.evaluate(() => window.__editor.state())))
}
await browser.close()
