// 舞台：中键滚轮缩放 + 动作写头角时视线让位、结束后恢复
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })
const pages = await browser.pages()
const stage = pages.find((p) => /\/app\/?/.test(p.url()) && !/editor|settings/.test(p.url()))
if (!stage) throw new Error('没找到舞台页面')

// 1) 中键滚轮缩放（事件带 buttons=4）
const z0 = await stage.evaluate(() => window.__probe.zoom())
await stage.evaluate(() => window.__probe.zoomAt('胸', -120))
await new Promise((r) => setTimeout(r, 700))
const z1 = await stage.evaluate(() => window.__probe.zoom())
console.log('ZOOM', JSON.stringify({ z0, z1, ok: z1 > z0 }))

// 2) 动作写头角 → 视线让位；动作结束 → 自动恢复
await stage.evaluate(() => window.__probe.idlePlay('东张西望'))
await stage.waitForFunction(() => window.__probe.yieldHead() === true, { timeout: 4000 })
const during = await stage.evaluate(() => ({
  y: window.__probe.yieldHead(), s: window.__probe.gazeStrength(), cur: window.__probe.idleState?.().current,
}))
await stage.waitForFunction(() => window.__probe.idleState?.().current == null, { timeout: 20000 })
await new Promise((r) => setTimeout(r, 400))
const after = await stage.evaluate(() => ({ y: window.__probe.yieldHead(), s: window.__probe.gazeStrength() }))
console.log('YIELD', JSON.stringify({ during, after, ok: during.y && during.s === 0 && !after.y && after.s > 0 }))

await browser.disconnect()
