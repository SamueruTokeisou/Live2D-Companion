// 舞台窗口 UI 回归：Ctrl+滚轮缩放 / 右键前倾开关 / 设置窗口主题
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })
const pages = await browser.pages()
const stage = pages.find((p) => /\/app\/?/.test(p.url()) && !/editor|settings/.test(p.url()))
if (!stage) throw new Error('没找到舞台页面：' + pages.map((p) => p.url()).join(', '))
const errors = []
stage.on('pageerror', (e) => errors.push(e.message))

const zoomStart = await stage.evaluate(() => window.__probe.zoom())
const hit = await stage.evaluate(() => window.__probe.zoomAt('胸', -120))
await new Promise((r) => setTimeout(r, 700))
const zoomAfter = await stage.evaluate(() => window.__probe.zoom())
console.log('ZOOM', JSON.stringify({ zoomStart, hit, zoomAfter }))

// 右键：应弹出工具条且只有一个「前倾 / 恢复」
await stage.evaluate(() => {
  window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
})
const menu = await stage.evaluate(() => ({
  hidden: document.querySelector('#tools')?.classList.contains('hidden'),
  label: document.querySelector('#tool-lean')?.textContent,
  buttons: document.querySelectorAll('#tools .tool').length,
}))
console.log('MENU', JSON.stringify(menu))

const leanOn = await stage.evaluate(async () => {
  document.querySelector('#tool-lean')?.click()
  await new Promise((r) => setTimeout(r, 120))
  window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  return {
    label: document.querySelector('#tool-lean')?.textContent,
    visible: !document.querySelector('#tools')?.classList.contains('hidden'),
  }
})
console.log('LEAN_ON', JSON.stringify(leanOn))

const leanOff = await stage.evaluate(async () => {
  document.querySelector('#tool-lean')?.click()
  await new Promise((r) => setTimeout(r, 120))
  window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  return { label: document.querySelector('#tool-lean')?.textContent }
})
console.log('LEAN_OFF', JSON.stringify(leanOff))

// 设置窗口：主题三选一 + 角色大小已删除
await stage.evaluate(() => window.shell.openSettings())
await new Promise((r) => setTimeout(r, 1500))
const all = await browser.pages()
const settings = all.find((p) => p.url().includes('settings.html'))
if (settings) {
  await new Promise((r) => setTimeout(r, 800))
  const info = await settings.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    modes: [...document.querySelectorAll('#theme-switch button')].map((b) => b.textContent),
    hasZoom: !!document.querySelector('#zoom'),
    hint: [...document.querySelectorAll('.hint')].map((h) => h.textContent).find((t) => t.includes('Ctrl+滚轮')) || '',
  }))
  console.log('SETTINGS', JSON.stringify(info))
  await settings.screenshot({ path: 'tmp/settings-theme.png' })
  await settings.close()
} else console.log('SETTINGS', '没打开')

console.log('ERRORS', errors.length ? errors : 'none')
await browser.disconnect()
