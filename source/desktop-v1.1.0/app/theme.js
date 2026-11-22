// 主题：设置窗口与动作编辑器共用一套「跟随系统 / 浅色 / 深色」。
//
// 状态存在主进程 settings.theme（默认 'auto'），窗口之间靠 shell.onSettings 同步；
// 没有壳层（浏览器里直接开 /app/editor.html 调样式）时回落到 localStorage。
//
// 用法：
//   import { initTheme, mountThemeSwitch } from './theme.js'
//   await initTheme()                       // 应用并开始跟随系统变化
//   mountThemeSwitch(document.querySelector('#theme-switch'))
//
// 注意：不要在这个模块里读 document.body —— 脚本是 module，可能在 body 解析前执行，
// 只碰 <html> 与传进来的节点。

const KEY = 'live2d-theme'
const MODES = ['auto', 'light', 'dark']
const LABEL = { auto: '跟随系统', light: '浅色', dark: '深色' }

/** 'auto' | 'light' | 'dark' → 实际生效的 'light' | 'dark' */
export function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch { return 'dark' }
}

let current = 'auto'
let media = null
const listeners = new Set()

function paint() {
  const resolved = resolveTheme(current)
  document.documentElement.dataset.themeMode = current
  document.documentElement.dataset.theme = resolved
  for (const fn of listeners) { try { fn(resolved, current) } catch {} }
}

function store(mode) {
  try { localStorage.setItem(KEY, mode) } catch {}
}

function readStore() {
  try {
    const v = localStorage.getItem(KEY)
    return MODES.includes(v) ? v : null
  } catch { return null }
}

/** 设置里改了主题（或另一个窗口改了）→ 这里跟着换 */
export function setThemeMode(mode, { persist = true } = {}) {
  current = MODES.includes(mode) ? mode : 'auto'
  if (persist) store(current)
  paint()
  return current
}

export function themeMode() { return current }

/** 初始化：先读 localStorage（首帧不闪），再等主进程的真实设置覆盖 */
export async function initTheme() {
  setThemeMode(readStore() || 'auto', { persist: false })
  try {
    media = window.matchMedia('(prefers-color-scheme: light)')
    media.addEventListener('change', () => { if (current === 'auto') paint() })
  } catch {}
  try {
    const s = await window.shell?.get?.()
    if (s?.theme) setThemeMode(s.theme, { persist: false })
    window.shell?.onSettings?.((next) => {
      const m = next?.theme
      // 外部（托盘/另一个窗口）改了才覆盖；没写 theme 的旧配置当 auto
      if (m !== undefined) setThemeMode(m || 'auto', { persist: false })
    })
  } catch {}
  return current
}

/** 画一个三选一的分段控件（跟随系统 / 浅色 / 深色），点一下立即生效并落盘 */
export function mountThemeSwitch(el) {
  if (!el) return () => {}
  el.classList.add('seg')
  el.innerHTML = MODES.map((m) => `<button data-mode="${m}" title="${LABEL[m]}">${LABEL[m]}</button>`).join('')
  const sync = () => {
    for (const b of el.querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === current)
  }
  el.onclick = (e) => {
    const b = e.target.closest('button[data-mode]')
    if (!b) return
    setThemeMode(b.dataset.mode)
    sync()
    try { window.shell?.set?.({ theme: b.dataset.mode }) } catch {}
  }
  listeners.add(sync)
  sync()
  return sync
}
