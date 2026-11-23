// Live2D Stage —— Electron 主进程。
//
// 形态：**无边框 / 透明 / 贴角色的独立软件**（不是嵌在 DSH 里）。
//   - 内置同一个静态服务（src/server/stage-server.mjs），窗口加载 http://127.0.0.1:<port>/app/
//   - 窗口尺寸 A 与模型尺寸 B 分离：A 改窗口大小，B 只改模型缩放（渲染层 zoom），互不牵连
//   - 穿透模式：win.setIgnoreMouseEvents(true, { forward: true })，用全局快捷键 Ctrl+Alt+L 找回
//   - 退出：Ctrl+Alt+Q（穿透态下也能用）
import { app, BrowserWindow, ipcMain, globalShortcut, shell, screen, dialog, Menu, Tray, nativeImage, nativeTheme, net, powerMonitor, safeStorage } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises'
import { existsSync, mkdirSync, readdirSync, appendFileSync, statSync, renameSync, readFileSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { ChatGptAuth, ProtectedAccountStore } from './kernel/chatgpt-auth.mjs'
import { LocalSpeech } from './kernel/local-speech.mjs'
import { ChatGptProvider } from './kernel/chatgpt-provider.mjs'
import { ChatRuntime, CHAT_ERRORS } from './kernel/chat-runtime.mjs'
import { EventKernel, localHandler } from './kernel/event-kernel.mjs'
import { StageBodyAdapter } from './kernel/stage-adapter.mjs'
import { visiblePosition } from './placement.mjs'
import { readSettings, writeSettings } from './persistence.mjs'
import { createStageServer } from '../src/server/stage-server.mjs'

// 控制台管道断开时（从终端/脚本启动后终端关闭）console.log 会抛 EPIPE，
// 不接住会弹「A JavaScript error occurred in the main process」并崩溃。
for (const s of [process.stdout, process.stderr]) {
  try { s.on('error', (e) => { if (e && e.code === 'EPIPE') return }) } catch {}
}

// ---------- 帧节奏 ----------
// 保留系统 vsync：出帧必须落在显示刷新的整数倍上，否则屏幕会把前一帧多停一个刷新、
// 后一帧少停一个 —— 观感就是「概率性抖动」（脸上最明显）。
// 实测（docs/PERF-RESEARCH.md §8）：240Hz 屏上关掉 vsync 后 rAF 被放开成 0.5ms 连发，
// 和合成器完全脱钩；开着时是 4.17ms 的干净网格。出帧节奏由渲染进程的 frameLoop 锚定（固定 60 帧）。
// 想对比 240Hz 面板在非对齐节奏下的表现，可临时设 STAGE_NO_VSYNC=1（仅供排查）。
if (process.env.STAGE_NO_VSYNC === '1') {
  app.commandLine.appendSwitch('disable-gpu-vsync')
  app.commandLine.appendSwitch('disable-frame-rate-limit')
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 便携/测试：STAGE_HOME 覆盖用户数据目录（设置文件跟着走，可做干净环境）
if (process.env.STAGE_HOME) { try { mkdirSync(process.env.STAGE_HOME, { recursive: true }); app.setPath('userData', process.env.STAGE_HOME) } catch {} }
// 启动参数：--model "路径\model3.json"（自动化安装 / 快捷方式用）
const ARG_MODEL = (() => { const i = process.argv.indexOf('--model'); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null })()
// 启动参数 / 环境变量：加载用户扩展（--ext "/extensions/a.js,/extensions/b.js" 或 STAGE_EXT）
const ARG_EXT = (() => {
  const i = process.argv.indexOf('--ext')
  const fromArg = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null
  // 两种写法都认：`--ext a.js` 与 `--ext=a.js`（后者是快捷方式/命令行里最常见的）
  const eq = process.argv.find((a) => a.startsWith('--ext='))
  const fromEq = eq ? eq.slice('--ext='.length).replace(/^"|"$/g, '') : null
  return fromEq || fromArg || process.env.STAGE_EXT || null
})()
// 原生 Cubism Core：渲染层要用 require 加载 .node，必须开 nodeIntegration（仅舞台窗口、且显式开启时）
const NATIVE_CORE = process.env.STAGE_NATIVE_CORE === '1'
// 模型目录：放在 exe 旁边的 model/（完整版内置；发布版用户把自己的模型丢进去即可，不用配绝对路径）
// 不再内置任何开发机绝对路径：开发时用设置里的路径 / --model / STAGE_MODEL 即可
const EXE_DIR = path.dirname(app.getPath('exe'))
const MODEL_DIRS = [path.join(EXE_DIR, 'model'), path.join(ROOT, 'model')]

// ---------- 启动日志：出问题时至少有一份能发回去的文件 ----------
// 「下载后打不开」这类反馈，没有日志只能靠猜；有日志一眼能看出卡在哪一步。
const LOG_DIR = path.join(app.getPath('userData'), 'logs')
const LOG_FILE = path.join(LOG_DIR, 'main.log')
function flog(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')}`
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    const st = statSafe(LOG_FILE)
    if (st && st.size > 1024 * 1024) renameSync(LOG_FILE, path.join(LOG_DIR, 'main.old.log'))
    appendFileSync(LOG_FILE, line + '\n')
  } catch {}
  try { console.log(line) } catch {}
}
function statSafe(p) { try { return statSync(p) } catch { return null } }

// ---------- 更新检查：启动时问一次仓库最新版本 ----------
// 只提醒不下载：桌宠不是安装器，弹一句「有新版本了哦」就够了，别替用户做主。
// 开发版默认不打扰（打包后才查）；测试用 STAGE_UPDATE_FAKE=9.9.9 或 STAGE_UPDATE_CHECK=1。
const UPDATE_REPO = 'FULASKA/-live2d-'
const UPDATE_URL = process.env.STAGE_UPDATE_URL || `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`

/** a 是否比 b 新（只比数字段；预发布后缀忽略） */
function semverGt(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const pb = String(b).replace(/^v/i, '').split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y
  }
  return false
}

async function checkForUpdates() {
  if (settings.updateCheck === false) return
  const fake = process.env.STAGE_UPDATE_FAKE
  if (!app.isPackaged && process.env.STAGE_UPDATE_CHECK !== '1' && !fake) return
  try {
    let latest = fake ? String(fake) : ''
    let url = `https://github.com/${UPDATE_REPO}/releases/latest`
    if (!latest) {
      const res = await net.fetch(UPDATE_URL, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `live2d-stage/${app.getVersion()}` },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) { flog('[update] 检查失败', res.status); return }
      const j = await res.json()
      latest = String(j?.tag_name || j?.version || '').replace(/^v/i, '')
      if (j?.html_url) url = j.html_url
    }
    if (!latest) return
    const current = app.getVersion()
    if (!semverGt(latest, current)) { flog('[update] 已是最新', current); return }
    flog('[update] 有新版本', current, '→', latest)
    if (win && !win.isDestroyed()) win.webContents.send('shell:update-available', { current, latest, url })
  } catch (e) {
    flog('[update] 检查异常', e?.message || String(e))
  }
}



// ---------- 故障日志：给「用户把报告丢给 AI」准备的 ----------
// 和 main.log 的区别：main.log 是流水（看流程），faults 是**事件**（看故障）。
// 渲染层的错误由它自己上报（fault:report），崩溃/加载失败/无响应在主进程记，
// 导出时合成一份 Markdown —— 用户不用描述现象，AI 直接能读。
const FAULT_FILE = path.join(LOG_DIR, 'faults.jsonl')
const FAULTS = []
let RENDERER_INFO = null
function ffault(kind, detail = {}) {
  const rec = { t: new Date().toISOString(), kind: String(kind), ...(detail || {}) }
  FAULTS.push(rec)
  if (FAULTS.length > 200) FAULTS.shift()
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(FAULT_FILE, JSON.stringify(rec) + '\n')
  } catch {}
  return rec
}
process.on('uncaughtException', (e) => {
  ffault('main:uncaught', { message: String(e?.message || e), stack: String(e?.stack || '').slice(0, 2000) })
  flog('[fault] uncaught', e?.message || String(e))
})
process.on('unhandledRejection', (e) => {
  ffault('main:unhandled-rejection', { message: String(e?.message || e), stack: String(e?.stack || '').slice(0, 2000) })
})

const HOME_DIR = app.getPath('home') || ''
// 不构造正则：用户目录在同一条路径里可能写成 C:\Users\x 也可能写成 C:/Users/x，
// 两种分隔符各扫一遍，大小写不敏感（Windows 路径本来就不区分大小写）。
const redact = (s) => {
  let out = String(s ?? '')
  if (HOME_DIR.length > 3) {
    const low = () => out.toLowerCase()
    for (const sep of ['\\\\', '\\', '/']) {
      const home = HOME_DIR.split(/[\\/]/).join(sep)
      const homeLow = home.toLowerCase()
      let i = low().indexOf(homeLow)
      while (i >= 0) {
        out = out.slice(0, i) + '<用户目录>' + out.slice(i + home.length)
        i = low().indexOf(homeLow)
      }
    }
  }
  return out
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '<已隐藏密钥>')
    .replace(/("token"\s*:\s*")[^"]+/g, '$1<已隐藏>')
}


function tailOf(file, n) {
  try { return readFileSync(file, 'utf8').split('\n').slice(-n).join('\n') } catch { return '(读不到)' }
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

/** 生成一份 AI 能直接读的故障报告（Markdown），返回文件路径 */
async function exportDiagnostic() {
  let gpu = null
  try { gpu = await app.getGPUInfo('basic') } catch {}
  const displays = screen.getAllDisplays().map((x) =>
    `${x.size.width}×${x.size.height} @${Math.round(x.displayFrequency || 0)}Hz ×${x.scaleFactor}${x.internal ? '(内屏)' : ''}`)
  const info = RENDERER_INFO || {}
  const md = []
  md.push('# Live2D 桌宠 · 故障报告')
  md.push('')
  md.push('> 把这一整份内容（或这个 .md 文件）发给你的 AI，让它据此排查。只贴一行报错通常不够。')
  md.push('')
  md.push('## 基本信息')
  md.push('| 项 | 值 |')
  md.push('| --- | --- |')
  const basic = [
    ['版本', `${app.getName()} ${app.getVersion()}`],
    ['Electron', process.versions.electron],
    ['Chrome', process.versions.chrome],
    ['Node', process.versions.node],
    ['系统', `${os.type()} ${os.release()} (${os.arch()})`],
    ['屏幕', displays.join(' / ')],
    ['引擎', `${info.engine || '?'}${info.nativeCore ? ' + 原生核心' : ''}`],
    ['视口/DPR', info.viewport ? `${info.viewport.join('×')} dpr=${info.dpr}` : '未知'],
    ['显卡', gpu ? (Array.isArray(gpu.gpuDevice) ? gpu.gpuDevice.map((d) => d.vendorString + ' ' + d.deviceString).join('; ') : '已获取') : '未获取'],
    ['窗口', win && !win.isDestroyed() ? JSON.stringify(win.getBounds()) : '无'],
    ['启动参数', process.argv.slice(1).join(' ')],
  ]
  for (const [k, v] of basic) md.push(`| ${k} | ${redact(v).replace(/\|/g, '\\|')} |`)
  md.push('')
  md.push('## 设置（已隐藏密钥）')
  md.push('```json')
  md.push(redact(JSON.stringify(settings, null, 2)))
  md.push('```')
  md.push('')
  md.push('## 故障记录（时间正序，最近 ' + FAULTS.length + ' 条）')
  if (!FAULTS.length) md.push('（本次运行没有记录到故障事件）')
  else {
    for (const f of FAULTS) {
      const { t, kind, ...rest } = f
      md.push('- ' + t + ' **' + kind + '** ' + redact(JSON.stringify(rest)).slice(0, 900))
    }
  }
  md.push('')
  md.push('## 主进程日志（main.log 尾部 120 行）')
  md.push('```text')
  md.push(redact(tailOf(LOG_FILE, 120)))
  md.push('```')
  md.push('')
  md.push('## 自查顺序（先看这几条）')
  md.push('1. 启动日志里有没有「模型」「Cubism Core」「贴图压缩」相关报错');
  md.push('2. 故障记录里 renderer:crash / webgl:context-lost 的次数与时间');
  md.push('3. 显卡/驱动与屏幕刷新率（透明窗口对驱动敏感）')
  const text = md.join('\n')
  const dest = path.join(app.getPath('userData'), `故障报告-${stamp()}.md`)
  writeFileSync(dest, text, 'utf8')
  ffault('diagnostic-exported', { path: dest, bytes: text.length, faults: FAULTS.length })
  flog('[fault] 已导出', dest)
  return dest
}



// ---------- 崩溃自愈：上次没成功起来 → 这次自动进安全模式 ----------
// 反馈里「双击闪一下就没、退出码主动中止、连窗口都没有」基本都是显卡/透明窗口的驱动兼容问题。
// 用启动标记判断：上一次启动没走到「窗口显示」就结束了，这一次就关掉硬件加速重试。
// 成功启动一次后标记置 true，下次自动恢复正常模式（有毛病也只是降级一次，不会永远降级）。
const BOOT_FILE = path.join(app.getPath('userData'), 'boot.json')
const ARG_SAFE = process.argv.includes('--safe') || process.env.STAGE_SAFE === '1'
let lastBoot = { ok: true, tries: 0 }
try { lastBoot = { ...lastBoot, ...JSON.parse(readFileSync(BOOT_FILE, 'utf8')) } } catch {}
const crashLastTime = lastBoot.ok === false
const SAFE = ARG_SAFE || crashLastTime
const bootTries = Number(lastBoot.tries || 0) + 1
try {
  writeFileSync(BOOT_FILE, JSON.stringify({ ok: false, safe: SAFE, tries: bootTries, startedAt: Date.now() }, null, 2))
} catch {}
if (SAFE) {
  try { app.disableHardwareAcceleration() } catch {}
  for (const sw of ['disable-gpu-compositing', 'disable-direct-composition', 'disable-gpu-shader-disk-cache']) {
    try { app.commandLine.appendSwitch(sw) } catch {}
  }
}
function bootFinished() {
  try { writeFileSync(BOOT_FILE, JSON.stringify({ ok: true, safe: SAFE, tries: bootTries, at: Date.now() }, null, 2)) } catch {}
}

// 未捕获异常：写日志 + 弹一个能看懂的框（带上日志路径），别让用户只看到「闪一下没了」
process.on('uncaughtException', (e) => {
  flog('[crash] uncaughtException', e?.stack || String(e))
  try { dialog.showErrorBox('桌宠出错了', `\n${e?.message || e}\n\n日志：${LOG_FILE}\n把这份日志发给我就能定位。`) } catch {}
})
process.on('unhandledRejection', (e) => {
  flog('[crash] unhandledRejection', (e && (e.stack || e.message)) || String(e))
})

/** 目录里挑一个 *.model3.json：优先「大肥鱼」，否则第一个 */
function pickModelIn(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.model3.json')).sort()
    if (!files.length) return null
    return path.join(dir, files.find((f) => f.startsWith('大肥鱼')) || files[0])
  } catch { return null }
}

/** 设置里的 model：相对路径按 exe 所在目录解析（配置里只存相对路径，换机不用改） */
function fromSettings() {
  if (!settings.model) return null
  const abs = path.isAbsolute(settings.model) ? settings.model : path.resolve(EXE_DIR, settings.model)
  return existsSync(abs) ? abs : null
}

/** 解析模型路径：命令行 --model → 设置 → exe 旁 model/ → 包内 resources/app/model → 环境变量 */
function resolveModel() {
  if (ARG_MODEL) {
    const abs = path.isAbsolute(ARG_MODEL) ? ARG_MODEL : path.resolve(process.cwd(), ARG_MODEL)
    if (existsSync(abs)) return abs
    flog('[model] --model 参数指向的文件不存在：', abs)
  }
  const fromCfg = fromSettings()
  if (fromCfg) return fromCfg
  for (const dir of MODEL_DIRS) { const f = pickModelIn(dir); if (f) return f }
  if (process.env.STAGE_MODEL && existsSync(process.env.STAGE_MODEL)) return process.env.STAGE_MODEL
  return null
}

/** 启动时拿模型：找不到就返回 null（由首次运行引导页处理，不再弹选择框后闪退） */
async function resolveModelOrPick() {
  return resolveModel()
}

/**
 * 启动预检：model3.json 能读、moc3 在、至少一张贴图在。
 *
 * 为什么需要：挂载/换模型后如果文件不完整，以前会照常开窗口 ——
 * 结果是一个「透明的空气窗口」，用户看到的就是「双击没反应」。
 * 预检不过就直接进引导页，把原因写在上面。
 */
function validateModelBasic(file) {
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'))
    const dir = path.dirname(file)
    const fr = json.FileReferences || {}
    if (!fr.Moc) return { ok: false, error: 'model3.json 里没有 Moc（moc3）引用' }
    if (!existsSync(path.resolve(dir, fr.Moc))) return { ok: false, error: `缺少 moc3：${fr.Moc}` }
    const tex = (fr.Textures || [])[0]
    if (tex && !existsSync(path.resolve(dir, tex))) return { ok: false, error: `缺少贴图：${tex}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `model3.json 读不了：${e?.message || e}` }
  }
}

// ---------- 贴图自动压缩：常驻软件不该一开机就吃 2GB ----------
// 模型的 4096/8192 图集解压后是 592MB 级别（8192² 单张就 256MB），缩到 2048 后 64MB。
// 这是**默认流程**：首次启动发现贴图过大就自动压一次（约 10 秒），之后一直用 _opt2048 副本。
// 跳过：环境变量 STAGE_NO_SHRINK=1；想重跑：双击「贴图压缩.cmd」。
const MAX_TEX = 2048

/** 只读 PNG 头拿宽高（不解码） */
function pngSize(file) {
  try {
    const fd = openSync(file, 'r')
    const b = Buffer.alloc(24)
    readSync(fd, b, 0, 24, 0)
    closeSync(fd)
    if (b.readUInt32BE(0) !== 0x89504e47) return null
    return [b.readUInt32BE(16), b.readUInt32BE(20)]
  } catch { return null }
}

/** 找出模型里第一张超过 MAX_TEX 的贴图 */
function oversizedTexture(modelFile) {
  try {
    const j = JSON.parse(readFileSync(modelFile, 'utf8'))
    for (const rel of j?.FileReferences?.Textures || []) {
      const p = path.resolve(path.dirname(modelFile), rel)
      if (!existsSync(p)) continue
      const s = pngSize(p)
      if (s && Math.max(s[0], s[1]) > MAX_TEX) return { rel, w: s[0], h: s[1] }
    }
  } catch (e) { flog('[opt] 读模型失败', String(e?.message || e)) }
  return null
}

async function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 430, height: 136, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#11151c', show: false,
  })
  await splash.loadFile(path.join(ROOT, 'app', 'optimizing.html'))
  splash.once('ready-to-show', () => splash.show())
  return splash
}

/** 调 tools/shrink-textures.ps1；成功后脚本自己把 settings.json 的 model 指到副本 */
async function autoShrinkTextures(modelFile) {
  const script = path.join(ROOT, 'tools', 'shrink-textures.ps1')
  if (!existsSync(script)) { flog('[opt] 缺 tools/shrink-textures.ps1，跳过压缩'); return false }
  flog('[opt] 开始压缩贴图：', modelFile)
  const splash = await createSplashWindow().catch(() => null)
  try {
    const code = await new Promise((resolve) => {
      let out = ''
      const cp = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Model', modelFile, '-NoLaunch'], {
        windowsHide: true,
        // STAGE_HOME 必须显式传：脚本按它决定把「改用 _opt2048」写进哪份 settings.json。
        // 不传就走 %APPDATA%\live2d-stage，开发版（userData = %APPDATA%\Electron）会读到旧路径，
        // 于是每次启动都重新压一遍、却始终用原图 —— 实测踩过。
        env: { ...process.env, STAGE_UTF8: '1', STAGE_HOME: app.getPath('userData') },
      })
      cp.stdout?.on('data', (d) => { out += String(d) })
      cp.stderr?.on('data', (d) => { out += String(d) })
      const timer = setTimeout(() => { flog('[opt] 超时，放弃'); try { cp.kill() } catch {} resolve(-1) }, 180000)
      cp.on('error', (e) => { clearTimeout(timer); flog('[opt] 启动脚本失败', String(e?.message || e)); resolve(-2) })
      cp.on('close', (c) => { clearTimeout(timer); flog('[opt] 退出码', c); if (out) flog('[opt] 输出', out.slice(-600)); resolve(c) })
    })
    return code === 0
  } finally { try { splash?.destroy() } catch {} }
}


const DEFAULTS = {
  width: 520,
  height: 760,
  x: null,          // 窗口位置（首次启动按屏幕右上角摆）
  y: null,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  gaze: true,
  strength: 1,
  headGain: 1.25,   // 转头幅度（ParamAngleX/Y 的增益倍数），设置窗口可调
  petGain: 1.6,
  idle: true,        // 待机动作（常驻微摆 + 随机成套动作 + 小台词）
  idleSpeed: 1,      // 待机频率倍数（越大换动作越勤；**不影响动作播放速度**）
  randomFaces: true, // 待机随机小表情（笑 / 吐舌头 / 眨眼）：关掉后只会动身体，脸不自己变
  actionSpeed: 0.8,  // 动作播放速度：1.0 = 预设速度上限（模型自带动作的节奏），只作用于动作轨道
  // 帧率不再是一项设置：固定 60 帧，由渲染进程按显示刷新周期锚定（见 docs/PERF-RESEARCH.md）。
  // 老配置里残留的 `fps` 字段读进来会被忽略，不迁移也不报错。
  alwaysOnTop: true,
  clickThrough: false,
  bubble: true,          // 气泡总开关
  border: false,         // 显示窗口边框（拖边框缩放；关掉后回到纯角色）
  padY: 0.02,            // 上下留白（0–0.2，占画布高度比例）；越小边框越贴角色
  bodyShape: 0,          // 体型：0 默认 / 0.4 体型1 / 1 体型2（Clothes2 参数，设置里拉条调）
  dragPhysics: true,     // 拖拽物理：拖动窗口时让模型自己的物理跟着甩（类似 VTS 的拖拽物理演算）
  autoStart: false,      // 开机自启（Windows 登录时启动舞台）
  theme: 'auto',         // 界面主题：auto 跟随系统 / light / dark（设置与编辑台共用）
  model: null,           // 启动时由 resolveModel() 决定（发布版没有模型，要用户选）
  nativeCore: false,     // 原生 Cubism Core（N-API 桥）：求值 ~1.7ms，比 WASM 版快约 5 倍；改后需重启
  engine: 'default',     // 渲染引擎：default = pixi8 + untitled / pixi7 = pixi7 + mulmotion（改后需重启）
  updateCheck: true,     // 启动时查一次仓库最新版本（有新版本用气泡提醒，不自动下载）
}

let settings = { ...DEFAULTS }
let win = null
let restarting = false
// 启动阶段（引导窗口 / 压缩贴图 splash 关闭时）不该触发「窗口全关 → 退出」
let bootGuard = true
let srv = null
let token = 'local-app'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() } else {
  app.on('second-instance', () => { try { if (win) { win.show(); win.focus() } } catch {} })
}


const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

// ---------- 编辑台（浏览器 webUI）共用的文件 / RPC ----------
// 动作 JSON 归主进程管（userData），HTTP 服务只做转发；舞台内部状态则转给舞台窗口。
const actionsFile = () => path.join(app.getPath('userData'), 'actions.json')
async function readActionsFile() {
  try { return JSON.parse(await readFile(actionsFile(), 'utf8')) } catch { return null }
}
async function writeActionsFile(data) {
  await mkdir(path.dirname(actionsFile()), { recursive: true })
  await writeFile(actionsFile(), JSON.stringify(data, null, 2))
  return { ok: true, file: actionsFile() }
}
/** 舞台窗口 RPC（设置窗口 / 编辑台共用；舞台没起来时明确返回失败） */
const lifecycle = { suspend: 0, resume: 0, displayChanges: 0 }
app.whenReady().then(() => {
  for (const event of ['suspend', 'resume']) powerMonitor.on(event, () => { lifecycle[event]++; if (event === 'resume') recoverPlacement() })
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => { lifecycle.displayChanges++; recoverPlacement() })
})
let companionKernel = null
let kernelEnabled = false
let kernelMode = 'local-test'
let chatRuntime = null
function getKernel() {
  if (!companionKernel) companionKernel = new EventKernel({ body: new StageBodyAdapter(callStageRpc), journal: row => {
    const file = path.join(LOG_DIR, 'kernel-events.jsonl')
    try {
      if (statSafe(file)?.size > 1024 * 1024) renameSync(file, path.join(LOG_DIR, 'kernel-events.old.jsonl'))
      appendFileSync(file, JSON.stringify(row) + '\n')
    } catch {}
  } })
  return companionKernel
}
function disableKernel(expectedMode = null) {
  if (expectedMode && expectedMode !== kernelMode) return
  kernelEnabled = false
  if (companionKernel) { companionKernel.cancel(); companionKernel.pause(true) }
}
let chatAuth = null
function getChat() {
  if (!chatRuntime) {
    chatAuth = new ChatGptAuth({ store: new ProtectedAccountStore(process.env.STAGE_COMPANION_AUTH_HOME || path.join(app.getPath('userData'), 'chatgpt-auth'), safeStorage), openExternal: url => shell.openExternal(url) })
    const sharedData = path.dirname(process.env.STAGE_COMPANION_AUTH_HOME || path.join(app.getPath('userData'), 'chatgpt-auth'))
    chatRuntime = new ChatRuntime({
      kernel: getKernel(), provider: new ChatGptProvider({ auth: chatAuth }),
      speech: new LocalSpeech({ configFile: path.join(sharedData, 'voice-reference', 'active.json') }),
      speechState: async () => (await callStageRpc('body:snapshot')).value,
    })
  }
  return chatRuntime
}
function selectKernelMode(mode) {
  const kernel = getKernel()
  if (kernelMode !== mode) disableKernel()
  kernelMode = mode; kernel.mode = mode
  kernel.handler = mode === 'chatgpt-plan' ? (event, ctx) => getChat().handle(event, ctx) : localHandler
  kernel.timeoutMs = mode === 'chatgpt-plan' ? 120000 : 8000
  kernel.aiConnected = mode === 'chatgpt-plan' && !!chatRuntime?.verified
  kernelEnabled = true; kernel.pause(false)
}
function openChatPanel() {
  childWins.get('kernel')?.close()
  const panel = openChild('chat', { file: 'chat-panel.html', width: 750, height: 780, minWidth: 560, minHeight: 580, title: '伙伴文字对话 · ChatGPT' })
  panel.once('closed', () => disableKernel('chatgpt-plan'))
}
function openKernelPanel() {
  childWins.get('chat')?.close()
  const panel = openChild('kernel', { file: 'kernel-panel.html', width: 740, height: 720, minWidth: 560, minHeight: 530, title: '伙伴内核 · 本地测试' })
  panel.once('closed', () => disableKernel('local-test'))
}
async function callStageRpc(op, payload) {
  if (op === 'local:chat') { openChatPanel(); return { ok: true } }
  if (String(op).startsWith('chat:')) {
    try {
      const chat = getChat(), command = op.slice(5), kernel = getKernel()
      if (command === 'enable') {
        if (typeof payload?.value !== 'boolean') throw new Error('invalid switch')
        if (payload.value) selectKernelMode('chatgpt-plan'); else disableKernel('chatgpt-plan')
      } else if (command === 'login') { chat.resetIdentity(); chat.provider.clearModels(); await chatAuth.start({ newAccount: payload?.newAccount === true }) }
      else if (command === 'cancel-login') chatAuth.cancel()
      else if (command === 'account') { chat.resetIdentity(); chat.provider.clearModels(); chatAuth.select(payload?.id) }
      else if (command === 'logout') { chat.resetIdentity(); chat.provider.clearModels(); await chatAuth.signOut() }
      else if (command === 'ack') { chatAuth.acknowledge(); await chat.provider.loadModels() }
      else if (command === 'models') await chat.provider.loadModels()
      else if (command === 'model') { chat.resetIdentity(); chat.provider.select(payload?.model) }
      else if (command === 'voice') { if (payload?.value === false) kernel.cancel(); chat.speech.setEnabled(payload?.value) }
      else if (command === 'manage-usage') await shell.openExternal('https://chatgpt.com/settings/usage')
      else if (command !== 'snapshot') {
        if (!kernelEnabled || kernelMode !== 'chatgpt-plan') return { ok: false, error: '请先开启文字对话。' }
        if (command === 'send') { await chatAuth.token(); chat.send(payload?.text) }
        else if (command === 'stop') kernel.cancel()
        else if (command === 'clear') chat.clear()
        else return { ok: false, error: '不支持的对话操作。' }
      }
      return { ok: true, value: { ...chat.snapshot(), auth: chatAuth.snapshot(), models: chat.provider.models, selectedModel: chat.provider.model, enabled: kernelEnabled && kernelMode === 'chatgpt-plan', state: kernel.state, queued: kernel.queue.length } }
    } catch (error) { return { ok: false, error: CHAT_ERRORS[error.code] || '对话操作未完成，请检查输入或重新登录。' } }
  }
  if (op === 'local:kernel') { openKernelPanel(); return { ok: true } }
  if (String(op).startsWith('kernel:')) {
    try {
      const kernel = getKernel()
      const command = op.slice(7)
      if (command === 'snapshot') return { ok: true, value: { ...kernel.snapshot(), enabled: kernelEnabled } }
      if (command === 'enable') {
        if (typeof payload?.value !== 'boolean') throw new Error('开关值无效')
        if (payload.value) selectKernelMode('local-test'); else disableKernel('local-test')
      } else {
        if (!kernelEnabled || kernelMode !== 'local-test') throw new Error('请先打开内核测试窗口')
        if (command === 'event') {
          const id = kernel.enqueue(payload?.type, { text: payload?.text })
          if (kernel.records.some(r => r.eventId === id && r.status === 'rejected')) return { ok: false, error: '队列已满，请先处理或清空待办。' }
        }
        else if (command === 'cancel') kernel.cancel(typeof payload?.eventId === 'string' ? payload.eventId : null)
        else if (command === 'pause' || command === 'quiet') {
          if (typeof payload?.value !== 'boolean') throw new Error('开关值无效')
          if (command === 'pause') kernel.pause(payload.value); else kernel.setQuiet(payload.value)
        }
        else if (command === 'timer') kernel.scheduleTimer(payload?.ms)
        else if (command === 'capabilities') return { ok: true, value: await kernel.body.capabilities() }
        else throw new Error('不支持的内核操作')
      }
      return { ok: true, value: { ...kernel.snapshot(), enabled: kernelEnabled } }
    } catch { return { ok: false, error: '内核操作未完成：请检查输入、舞台状态或是否已打开本地测试。' } }
  }
  if (String(op).startsWith('body:')) {
    if (!win || win.isDestroyed()) return { ok: false, error: '身体不可用' }
    try {
      const value = await win.webContents.executeJavaScript(`window.__companionBody?.(${JSON.stringify(op.slice(5))}, ${JSON.stringify(payload ?? null)})`)
      return { ok: !!value, value }
    } catch { return { ok: false, error: '身体请求失败' } }
  }
  if (op === 'local:health') {
    let frame = null
    if (win && !win.isDestroyed()) {
      frame = await Promise.race([
        win.webContents.executeJavaScript('window.__probe?.frameInfo?.() ?? null'),
        new Promise(resolve => setTimeout(() => resolve(null), 1500)),
      ])
    }
    return { ok: true, value: {
      schemaVersion: 1, uptimeSeconds: Math.round(process.uptime()),
      versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
      visible: !!win && !win.isDestroyed() && win.isVisible(), frame,
      processes: app.getAppMetrics().map(p => ({ pid: p.pid, type: p.type, cpu: p.cpu.percentCPUUsage, workingSetKiB: p.memory.workingSetSize, privateKiB: p.memory.privateBytes })),
      displays: screen.getAllDisplays().map(d => ({ width: d.size.width, height: d.size.height, scale: d.scaleFactor, hz: d.displayFrequency })),
      lifecycle: { ...lifecycle }, faultCount: FAULTS.length,
      faultKinds: [...new Set(FAULTS.map(f => f.kind))],
      settingsRecovered: existsSync(`${settingsFile()}.recovery.json`),
      debugging: app.commandLine.hasSwitch('remote-debugging-port'),
    } }
  }
  if (op === 'local:ping') return { ok: true, value: { pid: process.pid } }
  if (op === 'local:visibility') { if (payload?.visible) win?.show(); else win?.hide(); return { ok: true } }
  if (op === 'local:quit') { setTimeout(() => app.quit(), 150); return { ok: true } }
  if (op === 'local:settings') {
    openChild('settings', { file: 'settings.html', width: 470, height: 760, minWidth: 360, minHeight: 420, title: '桌宠设置' })
    return { ok: true }
  }

  if (!win || win.isDestroyed()) return { ok: false, error: '舞台窗口还没起来' }
  try {
    const value = await win.webContents.executeJavaScript(
      `window.__stageRpc(${JSON.stringify(String(op || ''))}, ${JSON.stringify(payload ?? null)})`,
      true,
    )
    return { ok: true, value }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}
/** 编辑台走浏览器：它自己渲染模型、自己读动作库，不占任务栏也不拖慢舞台窗口 */
function openEditorPage() {
  if (!srv) return
  const url = `${srv.url}/app/editor.html?token=${encodeURIComponent(token)}`
  flog('[editor] 打开编辑台', url)
  shell.openExternal(url).catch((e) => flog('[editor] 打开失败', e?.message || String(e)))
}

async function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...readSettings(settingsFile()) }
  } catch (error) {
    dialog.showErrorBox('配置需要恢复', String(error.message)); app.exit(1); throw error
  }
  settings.clickThrough = false // 上次退出时若在穿透态，重启一律恢复正常，避免「点不到」
}
/** 模型路径在 exe 目录内就存相对路径（打包后换目录/换机不用改配置） */
function settingsForDisk() {
  const out = { ...settings }
  if (out.model) {
    const rel = path.relative(EXE_DIR, out.model)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) out.model = rel.replace(/\\/g, '/')
  }
  return out
}

async function saveSettings() {
  saveSettingsSync()
}

function saveSettingsSync() {
  try { writeSettings(settingsFile(), settingsForDisk()) }
  catch (error) { ffault('settings:save', { message: String(error.message) }); console.error('[settings] 保存失败', error) }
}

// 渲染层按角色轮廓实时开关的穿透（区别于手动全窗穿透 settings.clickThrough）
let dynamicIgnore = false

/**
 * 开机自启：写 Windows 登录启动项。
 *
 * 以前这里有两处坑：
 *   1. `if (!app.isPackaged) return` —— 开发模式（npm run app）直接把自启关掉，
 *      而日常用的正是开发模式，于是设置里的开关形同虚设；
 *   2. 这个函数**从来没被调用过**（只有定义），所以即便打包版也不会注册。
 *
 * 开发模式下光写 electron.exe 的路径不够：登录时只会拉起一个空 Electron 壳，
 * 必须把应用目录一起当参数传过去（`electron.exe <appPath>`）。
 */
function applyAutoStart() {
  try {
    const on = !!settings.autoStart
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [] })
    } else {
      // 开发模式：process.execPath = electron.exe。
      // 参数必须是**入口脚本**（和 `npm run app` 等价：electron app/main.mjs），
      // 传应用目录会去那里找 package.json，而 app/ 下没有 → 登录时只会开一个空壳。
      app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [path.join(app.getAppPath(), 'main.mjs')] })
    }
    const st = app.getLoginItemSettings()
    console.log('[autostart]', on ? '已注册' : '已关闭', app.isPackaged ? '(打包)' : '(开发)', JSON.stringify({ openAtLogin: st.openAtLogin, exe: st.executableWillLaunchAtLogin }))
  } catch (e) { console.error('[autostart]', e && e.message) }
}

function applyWindowSettings() {
  if (!win) return
  win.setAlwaysOnTop(!!settings.alwaysOnTop, 'screen-saver')
  win.setIgnoreMouseEvents(!!settings.clickThrough || dynamicIgnore, { forward: true })
}

/**
 * 设置补丁（IPC / 托盘菜单共用）：合并 → 生效 → 落盘 → 广播 → 刷新托盘勾选状态。
 * 以前这套逻辑只写在 shell:set 里，托盘要改同一批开关就得复制一遍。
 */
async function applySettingsPatch(patch = {}) {
  settings = { ...settings, ...patch }
  if (patch.width || patch.height) {
    win?.setContentSize(Math.round(settings.width), Math.round(settings.height))
  }
  applyWindowSettings()
  // 自启是系统状态，改了设置必须落一次；启动时也会再落一次（见 main()）
  if ('autoStart' in patch) applyAutoStart()
  await saveSettings()
  broadcastSettings()
  refreshTrayMenu()
  return { ...settings }
}

function recoverPlacement() {
  if (!win || win.isDestroyed()) return
  const bounds = win.getBounds()
  const target = visiblePosition(bounds, screen.getAllDisplays().map(d => d.workArea))
  if (target.x !== bounds.x || target.y !== bounds.y) win.setPosition(target.x, target.y)
}

async function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  // 原生 core 开关：环境变量优先，其次设置（两者都需要重启后生效）
  const useNative = NATIVE_CORE || settings.nativeCore === true
  const query = [
    useNative ? 'core=native' : '',
    settings.engine === 'pixi7' ? 'engine=pixi7' : '',
    ARG_EXT ? `ext=${encodeURIComponent(ARG_EXT)}` : '',
  ].filter(Boolean).join('&')
  win = new BrowserWindow({
    width: settings.width,
    height: settings.height,
    x: Number.isFinite(settings.x) ? Math.round(settings.x) : (workArea ? Math.round(workArea.x + workArea.width - settings.width - 40) : undefined),
    y: Number.isFinite(settings.y) ? Math.round(settings.y) : (workArea ? Math.round(workArea.y + 40) : undefined),
    // STAGE_OPAQUE=1 只用于性能对照实验：不做透明合成，看帧率上限是不是被透明窗吃掉
    transparent: process.env.STAGE_OPAQUE !== '1',
    frame: false,
    resizable: false,
    hasShadow: false,
    // 任务栏只留托盘图标：设置/编辑器这类 2、3 级窗口仍是普通窗口（默认进任务栏）
    skipTaskbar: true,
    backgroundColor: '#00000000',
    icon: path.join(ROOT, 'assets', 'app.ico'),
    show: false,
    webPreferences: { autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(ROOT, 'app', 'preload.cjs'),
      // 原生 core 模式：关 contextIsolation 让 preload 能把安装器挂进页面世界
      contextIsolation: !useNative,
      sandbox: !useNative,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  recoverPlacement()
  win.setBackgroundColor('#00000000')
  try {
    const prefs = win.webContents.getLastWebPreferences ? win.webContents.getLastWebPreferences() : {}
    flog('[native] prefs', JSON.stringify({ nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation }))
  } catch (e) { flog('[native] prefs err', e.message) }
  win.once('ready-to-show', () => {
    win.show()
    // 等舞台稳定下来再查（别和模型加载抢带宽/主线程）
    setTimeout(() => { checkForUpdates().catch(() => {}) }, 8000)
    // 窗口真的显示出来了才算「启动成功」，否则下次启动继续走安全模式
    setTimeout(bootFinished, 2500)
  })
  // 渲染层报错 / 加载失败 / 渲染进程崩了：都写进日志，下次「打不开」有据可查
  win.webContents.on('console-message', (...a) => {
    const o = a[0] && typeof a[0] === 'object' && 'message' in a[0]
      ? a[0] : { level: a[1], message: a[2], lineNumber: a[3], sourceId: a[4] }
    const lv = o.level
    if (lv === 'error' || lv === 3 || lv === 'warning') flog('[renderer]', `[${lv}]`, String(o.message ?? ''), o.sourceId || '')
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => { flog('[load] 失败', code, desc, url); ffault('window:load-failed', { code, desc, url }) })
  // 渲染进程崩了（显卡驱动重置 / 显存耗尽 / OOM）：自动重建一次，别让角色无声消失。
  // 起来不到 60 秒又崩 = 不是偶发；第 3 次就停手，只留日志，避免崩溃循环刷爆日志。
  let crashReloads = 0
  let stableTimer = null
  win.webContents.on('did-start-loading', () => { if (kernelEnabled) disableKernel() })
  win.webContents.on('did-finish-load', () => {
    clearTimeout(stableTimer)
    stableTimer = setTimeout(() => { crashReloads = 0 }, 60000)
  })
  win.webContents.on('render-process-gone', (_e, d) => {
    flog('[renderer] 进程退出', d)
    ffault('renderer:crash', { ...(d || {}), reloads: crashReloads })
    if (d?.reason === 'clean-exit') return
    crashReloads += 1
    if (crashReloads > 2) { flog('[renderer] 连续崩溃', crashReloads, '次，停止自动重建'); return }
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      flog('[renderer] 自动重建第', crashReloads, '次')
      win.reload()
    }, 700 * crashReloads)
  })
  win.webContents.on('preload-error', (_e, p, err) => { flog('[preload] 失败', p, err?.message || String(err)); ffault('window:preload-failed', { path: p, message: err?.message || String(err) }) })
  // 拖动的「收尾」不能只靠渲染层发 drag-end：页面重载/失焦时那个事件不会来，
  // 定时器会残留并持续把窗口拽向光标。
  win.webContents.on('did-start-loading', stopWindowDrag)
  win.on('blur', stopWindowDrag)

  // 可见性推送：隐藏/最小化时让渲染层真的停帧。
  // 她是常驻进程（backgroundThrottling:false），隐藏后浏览器不会替我们降频，
  // 帧循环照旧按 60 帧烧 CPU/GPU —— 约等于白占一个核。别只靠页面自己的 visibilitychange：
  // 各平台对「窗口被 hide()」是否算 document.hidden 并不一致，主进程这边是确定的。
  const pushStageActive = () => {
    if (!win || win.isDestroyed()) return
    let on = false
    try { on = win.isVisible() && !win.isMinimized() } catch { on = false }
    try { win.webContents.send('shell:stage-active', on) } catch {}
  }
  for (const ev of ['hide', 'show', 'minimize', 'restore']) win.on(ev, pushStageActive)
  win.on('unresponsive', () => ffault('window:unresponsive', {}))

  // 位置记忆：搬完窗口 500ms 后落盘（拖动过程中不写，避免每帧 IO）
  let moveTimer = null
  win.on('moved', () => {
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    settings.x = x
    settings.y = y
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => { moveTimer = null; saveSettings() }, 500)
  })
  await win.loadURL(`${srv.url}/app/${query ? `?${query}` : ''}`)
  applyWindowSettings()
  win.on('closed', () => { win = null })
  startAgentStatusFeed(win)
}

// ---------- DSH 工作状态：读桥接插件写的状态文件，推给渲染层 ----------
// 插件（dsh-live2d-bridge）在 DSH 侧监听 session/event，原子写 ~/.dsh/live2d/status.json；
// 这里只做「文件变了就转发」，不解析业务、不阻塞界面。文件不在 = DSH 侧没装插件，舞台按空闲处理。
const AGENT_STATUS_FILE = path.join(app.getPath('userData'), 'integration', 'status.json')

// 外部控制入口的发现文件：端口随机、token 只有主进程知道，agent/CLI 从这里读。
// 不做「退出即删」—— 留下的旧端口比消失的文件更容易被排查（连不上就能判断没开）。
const ENDPOINT_FILE = path.join(app.getPath('userData'), 'integration', 'endpoint.json')
async function writeEndpoint() {
  try {
    await mkdir(path.dirname(ENDPOINT_FILE), { recursive: true })
    await writeFile(ENDPOINT_FILE, JSON.stringify({
      url: srv.url,
      port: srv.port,
      token,
      pid: process.pid,
      model: settings.model,
      protocol: 1,
      at: Date.now(),
    }, null, 2))
  } catch (e) { console.warn('[endpoint] 写入失败', e?.message || e) }
}
function startAgentStatusFeed(target) {
  let lastSig = ''
  let lastAt = 0
  const tick = async () => {
    if (!target || target.isDestroyed()) return
    try {
      const st = await stat(AGENT_STATUS_FILE).catch(() => null)
      if (!st) { lastSig = ''; return }
      const sig = `${st.mtimeMs}:${st.size}`
      if (sig === lastSig) return
      lastSig = sig
      const raw = await readFile(AGENT_STATUS_FILE, 'utf8')
      let snap = null
      try { snap = JSON.parse(raw) } catch { return }
      if (!snap || typeof snap !== 'object') return
      const at = Number(snap.at || 0)
      if (at && at === lastAt) return
      lastAt = at
      target.webContents.send('agent:status', {
        state: snap.state ?? null,
        task: snap.task ?? null,
        tool: snap.tool ?? null,
        detail: snap.detail ?? null,
        at: at || Date.now(),
      })
    } catch {}
  }
  setInterval(tick, 400).unref?.()
  tick()
}

// 窗口尺寸跟随角色：尺寸由渲染层按「模型画布 × 角色大小」算好，这里只负责
// **保持中心不变**地改大小（角色在窗口里是居中 contain，所以改完依然居中）；
// 贴近屏幕边缘时按工作区夹一下，不会把窗口推出屏幕。
// ---------- 拖边框缩放 ----------
// 渲染层只报告「按下了哪条边」，真正的尺寸跟全局光标走（窗口在被移动时，
// 窗口内坐标会漂，只有屏幕坐标是稳的）。比例由起始窗口锁定，拖角/拖边都等比。
let borderDrag = null

function stopBorderDrag(save = true) {
  if (!borderDrag) return
  clearInterval(borderDrag.timer)
  clearTimeout(borderDrag.guard)
  borderDrag = null
  if (save && win && !win.isDestroyed()) {
    const [w, h] = win.getSize()
    settings.width = w
    settings.height = h
    saveSettings()
  }
}

function wireBorderDrag() {
  ipcMain.on('win:scale-begin', (_e, edge = 'se') => {
    if (!win || win.isDestroyed()) return
    stopBorderDrag(false)
    const start = win.getBounds()
    const ratio = start.width / start.height
    const tick = () => {
      if (!win || win.isDestroyed() || !borderDrag) return
      const p = screen.getCursorScreenPoint()
      const e = borderDrag.edge
      let w
      if (/[ew]/.test(e)) w = /e/.test(e) ? p.x - start.x : start.x + start.width - p.x
      else {
        const hh = /s/.test(e) ? p.y - start.y : start.y + start.height - p.y
        w = hh * ratio
      }
      w = Math.round(Math.max(240, Math.min(1600, w)))
      const h = Math.round(w / ratio)
      const x = /w/.test(e) ? start.x + start.width - w : /e/.test(e) ? start.x : Math.round(start.x + (start.width - w) / 2)
      const y = /n/.test(e) ? start.y + start.height - h : /s/.test(e) ? start.y : Math.round(start.y + (start.height - h) / 2)
      win.setBounds({ x, y, width: w, height: h })
    }
    borderDrag = {
      edge: String(edge),
      timer: setInterval(tick, 16),
      // 兜底：pointerup 丢了也不能让窗口一直跟着鼠标缩
      guard: setTimeout(() => stopBorderDrag(true), 30000),
    }
    tick()
  })
  ipcMain.on('win:scale-end', () => stopBorderDrag(true))
}

// ---------- 窗口尺寸 / 缩放：专用通道 ----------
// 尺寸变化（滚轮缩放、适配）以前每次 IPC 都 saveSettings() + broadcastSettings()：
// 一个滚轮手势写十几次 settings.json、广播十几次、重建托盘菜单十几次，
// 主进程被磁盘 IO 和序列化占住，表现就是「缩放慢半拍、滚快了掉帧」。
// 现在内存里立刻生效，松手 420ms 后统一落盘 + 广播一次（设置窗口最后看到的也是最终值）。
let sizePersistTimer = null
function scheduleSizePersist(delay = 420) {
  if (sizePersistTimer) clearTimeout(sizePersistTimer)
  sizePersistTimer = setTimeout(() => {
    sizePersistTimer = null
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    settings.x = b.x
    settings.y = b.y
    settings.width = b.width
    settings.height = b.height
    saveSettings()
    broadcastSettings()
  }, delay)
}

function wireZoom() {
  ipcMain.on('win:zoom', (_e, at = {}) => {
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    const k = Number(at.k)
    const W = Math.max(180, Math.round(Number(at.w) || b.width * (k > 0 ? k : 1)))
    const H = Math.max(220, Math.round(Number(at.h) || b.height * (k > 0 ? k : 1)))
    let x = b.x
    let y = b.y
    // 光标下那个点不动：左上角 = 光标 − (光标 − 旧左上角) × k
    if (Number.isFinite(at.sx) && Number.isFinite(at.sy) && k > 0) {
      x = Math.round(at.sx - (at.sx - b.x) * k)
      y = Math.round(at.sy - (at.sy - b.y) * k)
    }
    if (b.width === W && b.height === H && b.x === x && b.y === y) return
    win.setBounds({ x, y, width: W, height: H })
    settings.width = W
    settings.height = H
    settings.x = x
    settings.y = y
    // zoom 也一并记下：松手后的广播要带回这个值，否则渲染层会按旧 zoom 再算一次尺寸，
    // 表现为「缩放后弹回原样」。
    const z = Number(at.zoom)
    if (Number.isFinite(z) && z > 0) settings.zoom = Math.round(z * 1000) / 1000
    scheduleSizePersist()
  })
}

function wireFit() {
  ipcMain.on('win:fit', (_e, size = {}) => {
    if (!win || win.isDestroyed()) return
    const W = Math.max(180, Math.round(Number(size.w) || 0))
    const H = Math.max(220, Math.round(Number(size.h) || 0))
    const b = win.getBounds()
    if (process.env.STAGE_DEBUG_MOVE) console.log('[fit]', JSON.stringify({ from: [b.x, b.y, b.width, b.height], want: [W, H] }))
    // 滚轮缩放：矩形绕光标缩放（k 倍）。用户定的语义：
    //   (0,0)-(3,4) 的矩形、光标 (1,1)、放大 2 倍 → (-1,-1)-(5,7)
    // 即宽高×k，左上角 = 光标 − (光标 − 旧左上角)×k。内容随窗口等比放大，
    // 所以「光标下那个点不动」是这条规则的必然结果，不需要事后再补一次位移。
    const rect = size.anchor?.rect
    if (rect && Number.isFinite(rect.k) && rect.k > 0) {
      const k = rect.k
      const W2 = Math.max(180, Math.round(b.width * k))
      const H2 = Math.max(220, Math.round(b.height * k))
      const x2 = Math.round(rect.sx - (rect.sx - b.x) * k)
      const y2 = Math.round(rect.sy - (rect.sy - b.y) * k)
      win.setBounds({ x: x2, y: y2, width: W2, height: H2 })
      settings.width = W2
      settings.height = H2
      settings.x = x2
      settings.y = y2
      scheduleSizePersist()
      return
    }
    const a = size.anchor
    if (a && Number.isFinite(a.sx) && Number.isFinite(a.cx)) {
      const { workArea } = screen.getDisplayNearestPoint({ x: Math.round(a.sx), y: Math.round(a.sy) })
      const x = Math.min(Math.max(Math.round(a.sx - a.cx), workArea.x), workArea.x + workArea.width - W)
      const y = Math.min(Math.max(Math.round(a.sy - a.cy), workArea.y), workArea.y + workArea.height - H)
      win.setBounds({ x, y, width: W, height: H })
      settings.width = W
      settings.height = H
      settings.x = x
      settings.y = y
      scheduleSizePersist()
      return
    }
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    // 尺寸没变就什么都不做：以前这里会用「四舍五入后的中心」重算位置，
    // 605 这种奇数宽 +1px/次 地累积，窗口就会以 5px/s 缓慢漂移。
    if (b.width === W && b.height === H) return
    const { workArea } = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) })
    const x = Math.min(Math.max(Math.round(cx - W / 2), workArea.x), workArea.x + workArea.width - W)
    const y = Math.min(Math.max(Math.round(cy - H / 2), workArea.y), workArea.y + workArea.height - H)
    win.setBounds({ x, y, width: W, height: H })
    settings.width = W
    settings.height = H
    settings.x = x
    settings.y = y
    scheduleSizePersist()
  })
}

// 中键搬窗口：主进程按全局光标锚点搬（读系统光标是绝对量，不会像事件增量那样累积漂移）
let dragTimer = null
let dragBase = null
// 结束拖动：任何「可能收不到 drag-end」的情况（页面重载、焦点丢失、窗口销毁）都要停掉，
// 否则这个 16ms 定时器会一直把窗口往光标位置拽 —— 表现为窗口自己慢慢漂移。
function stopWindowDrag() {
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = null
  dragBase = null
}
function wireWindowDrag() {
  let dragStartedAt = 0
  // 诊断模式：STAGE_DRAG_LOG=1 时，逐帧记录「光标 / 期望位置 / 实际位置」，
  // 松手后写到 userData/drag-log.json。排查「一卡一卡」用。
  let dragLog = process.env.STAGE_DRAG_LOG ? [] : null
  let lastMoveAt = 0
  let lastCursor = { x: 0, y: 0 }
  const applyDrag = (cx, cy, via) => {
    if (!win || win.isDestroyed() || !dragBase) return
    const tx = Math.round(dragBase.x + (cx - dragBase.cx))
    const ty = Math.round(dragBase.y + (cy - dragBase.cy))
    if (tx === lastCursor.x && ty === lastCursor.y) return   // 同一位置不重复 setPosition
    lastCursor = { x: tx, y: ty }
    win.setPosition(tx, ty)
    if (dragLog) {
      const [ax, ay] = win.getPosition()
      dragLog.push({ t: Date.now() - dragStartedAt, via, cx, cy, tx, ty, ax, ay })
    }
  }
  ipcMain.on('win:drag-begin', (_e, at = {}) => {
    if (!win) return
    stopWindowDrag()
    // 锚点用按下事件自带的屏幕坐标：和后续 pointermove 的 screenX 同一来源，
    // 不会再出现「主进程读的光标」与「事件坐标」因为 DPI/取整差一截而让窗口先跳一下
    const q = Number.isFinite(at.sx) && Number.isFinite(at.sy) ? { x: Math.round(at.sx), y: Math.round(at.sy) } : screen.getCursorScreenPoint()
    const [x, y] = win.getPosition()
    dragBase = { cx: q.x, cy: q.y, x, y }
    dragStartedAt = Date.now()
    lastMoveAt = 0
    lastCursor = { x, y }
    if (dragLog) dragLog = [{ t: 0, ev: 'begin', cx: q.x, cy: q.y, x, y }]
    if (dragTimer) clearInterval(dragTimer)
    // 兜底轮询：只负责「事件没送到」的情况（页面卡住 / 指针离开又回来）。
    // 正常情况下每帧由 win:drag-move 直接驱动 —— 因为 Windows 上
    // screen.getCursorScreenPoint() 是同步调用，16ms 定时器实测会退化成 ~30ms 一拍，
    // 快速拖动就是一跳一跳的。
    dragTimer = setInterval(() => {
      if (!win || win.isDestroyed() || !dragBase) return
      if (Date.now() - dragStartedAt > 60000) { stopWindowDrag(); return }
      if (Date.now() - lastMoveAt < 45) return
      const p = screen.getCursorScreenPoint()
      applyDrag(p.x, p.y, 'poll')
    }, 16)
  })
  ipcMain.on('win:drag-move', (_e, { sx, sy } = {}) => {
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
    lastMoveAt = Date.now()
    applyDrag(sx, sy, 'ev')
  })
  ipcMain.on('win:drag-end', () => {
    stopWindowDrag()
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      settings.x = x
      settings.y = y
      saveSettings()
    }
    if (dragLog) {
      const file = path.join(app.getPath('userData'), 'drag-log.json')
      try {
        writeFileSync(file, JSON.stringify(dragLog, null, 1))
        console.log('[drag-log]', dragLog.length, '帧 →', file)
      } catch (e) { console.log('[drag-log] 写入失败', e?.message) }
      dragLog = []
    }
  })
}

// ---------- 系统托盘 ----------
// 舞台窗口从任务栏收走（skipTaskbar），主入口改成托盘：
// 设置 / 编辑器仍是普通窗口（保留任务栏），托盘里只放「日常会用到的」几个开关。
let tray = null

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed?.()) return
  const visible = !!win && !win.isDestroyed() && win.isVisible()
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? '隐藏角色' : '显示角色', click: () => toggleStageWindow() },
    { type: 'separator' },
    { label: '设置…', click: () => openChild('settings', { file: 'settings.html', width: 432, height: 760, minWidth: 360, minHeight: 420, title: '设置 · Live2D Stage' }) },
    { label: '编辑台（实验）…', click: () => openEditorPage() },
    // 引擎 / 原生核心是建窗口时定死的（URL 参数 + 沙箱配置），改完必须重建舞台
    { label: '重启引擎（应用引擎/核心设置）', click: () => { restartStage() } },
    { type: 'separator' },
    { label: '穿透模式（Ctrl+Alt+L）', type: 'checkbox', checked: !!settings.clickThrough, click: (i) => applySettingsPatch({ clickThrough: !!i.checked }) },
    { label: '窗口置顶', type: 'checkbox', checked: !!settings.alwaysOnTop, click: (i) => applySettingsPatch({ alwaysOnTop: !!i.checked }) },
    { label: '鼠标跟随', type: 'checkbox', checked: settings.gaze !== false, click: (i) => applySettingsPatch({ gaze: !!i.checked }) },
    { type: 'separator' },
    {
      label: '导出故障报告…',
      click: () => exportDiagnostic().then((p) => {
        try { shell.showItemInFolder(p) } catch {}
        try { dialog.showMessageBox({ type: 'info', title: '故障报告已导出', message: '把这份文件发给你的 AI', detail: p }) } catch {}
      }).catch((e) => flog('[fault] 导出失败', e?.message || String(e))),
    },
    { label: '退出', click: () => { try { app.quit() } catch {} } },
  ]))
  tray.setToolTip('Live2D Stage')
}

function toggleStageWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) win.hide()
  else { win.show(); win.focus() }
  refreshTrayMenu()
}

/**
 * 重建舞台窗口：引擎分支与原生核心开关在建窗时就写死（URL 查询串 + sandbox/contextIsolation），
 * 只 reload 是改不动的，必须销毁窗口重新创建。托盘/设置/其他子窗口都不受影响。
 */
async function restartStage() {
  disableKernel()
  restarting = true
  try {
    flog('[stage] 重启引擎')
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      if (Number.isFinite(x) && Number.isFinite(y)) { settings.x = x; settings.y = y }
      win.removeAllListeners()
      win.destroy()
    }
  } catch (e) {
    flog('[stage] 重启前清理失败', e?.message || String(e))
  }
  win = null
  await saveSettings()
  try {
    await createWindow()
  } catch (e) {
    flog('[stage] 重启失败', e?.message || String(e))
  } finally {
    restarting = false
  }
  refreshTrayMenu()
}

function createTray() {
  if (tray) return tray
  try {
    const ico = path.join(ROOT, 'assets', 'app.ico')
    const png = path.join(ROOT, 'assets', 'app-icon.png')
    const img = existsSync(ico) ? ico : png
    tray = new Tray(img)
    tray.on('click', () => toggleStageWindow())
    refreshTrayMenu()
    flog('[tray] 已创建', img)
  } catch (e) {
    flog('[tray] 创建失败', e?.message || String(e))
  }
  return tray
}
// 覆盖层窗口只负责角色：设置类界面一律开成独立普通窗口（可拖动、有标题栏、不进穿透层），
// 覆盖层也就不用为了塞面板临时改宽度——尺寸与内容从此解耦。
const childWins = new Map()
function openChild(key, { file, ...opts }) {
  const cur = childWins.get(key)
  if (cur && !cur.isDestroyed()) { cur.focus(); return cur }
  const w = new BrowserWindow({
    autoHideMenuBar: true,
    // 窗口底色跟主题一致，避免浅色主题下开窗先闪一下深色
    backgroundColor: (settings.theme === 'light' || (settings.theme !== 'dark' && !nativeTheme.shouldUseDarkColors))
      ? '#eef1f6' : '#0f131b',
    ...opts,    webPreferences: { autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(ROOT, 'app', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 必须显式关沙箱：Electron 20+ 默认 sandbox=true，而沙箱里的 preload 只能 require
      // 白名单模块（electron/events/timers/url），`require('node:path')` 会直接抛
      // 「module not found: node:path」把整份 preload 干掉 —— 表现就是设置窗口里
      // window.shell 是 undefined，所有开关/换引擎/重启全部静默失效。
      sandbox: false,
      // 子窗口被挡住也不能停帧（编辑器预览要一直播）
      backgroundThrottling: false,
    },
  })
  w.loadURL(`${srv.url}/app/${file}`)
  childWins.set(key, w)
  w.on('closed', () => { if (childWins.get(key) === w) childWins.delete(key); updateStageThrottle() })
  updateStageThrottle()
  return w
}

/**
 * 设置/编辑器等子窗口打开时，把舞台降到 30fps：
 * 单帧约 11ms 的舞台会和设置界面抢 CPU/GPU，表现为设置界面自己卡、
 * 舞台那边出现「短卡顿」。关掉子窗口立刻恢复原帧率。
 */
function updateStageThrottle() {
  if (!win || win.isDestroyed()) return
  try { win.webContents.send('shell:throttle', childWins.size > 0) } catch {}
}

/** 设置变了广播给所有窗口：覆盖层按新值立即生效，设置窗口刷新读数 */
function broadcastSettings() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('shell:changed', { ...settings })
  }
}

// ---------- IPC ----------
function wireIpc() {
  // ---- 故障日志（渲染层上报 + 一键导出）----
  ipcMain.on('fault:report', (_e, payload = {}) => ffault(payload?.kind || 'renderer', payload?.detail || {}))
  ipcMain.on('fault:info', (_e, info) => { RENDERER_INFO = info || null })
  ipcMain.handle('fault:export', () => exportDiagnostic())

  ipcMain.handle('shell:get', () => ({ ...settings, token, port: srv?.port || null }))
  ipcMain.handle('shell:set', async (_e, patch = {}) => applySettingsPatch(patch))
  ipcMain.handle('model:choose', async () => {
    const python = process.env.STAGE_MANAGER_PYTHON
    const manager = process.env.STAGE_MANAGER_FILE
    if (!python || !manager) return { ok: false, error: '请使用桌面的角色管理快捷方式' }
    const child = spawn(python, [manager], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return { ok: true }
  })
  ipcMain.on('win:move', (_e, { dx = 0, dy = 0 } = {}) => {
    if (!win) return
    if (process.env.STAGE_DEBUG_MOVE) console.log('[move]', dx, dy)
    const [x, y] = win.getPosition()
    win.setPosition(Math.round(x + dx), Math.round(y + dy))
  })
  // 缩放锚点要用：光标停在某个模型点上，缩放后把窗口挪回去让那个点还在光标下
  ipcMain.handle('win:bounds', () => (win && !win.isDestroyed() ? win.getBounds() : null))
  // ---------- 改动补丁：记录我们这层加的姿势/台词/反应/热区，发布时只发这个文件 ----------
  const patchFile = () => path.join(app.getPath('userData'), 'stage-patch.json')
  ipcMain.handle('patch:save', async (_e, data) => {
    try {
      await mkdir(path.dirname(patchFile()), { recursive: true })
      await writeFile(patchFile(), JSON.stringify(data, null, 2))
      return { ok: true, file: patchFile() }
    } catch (e) { return { ok: false, error: String(e?.message || e) } }
  })
  ipcMain.handle('patch:load', async () => {
    try { return JSON.parse(await readFile(patchFile(), 'utf8')) } catch { return null }
  })
  // ---------- 动作编辑器：动作 JSON 的读写（编辑台/设置窗口共用） ----------
  ipcMain.handle('actions:save', async (_e, data) => {
    try { return await writeActionsFile(data) } catch (e) { return { ok: false, error: String(e?.message || e) } }
  })
  ipcMain.handle('actions:load', () => readActionsFile())
  ipcMain.on('kernel:click', (event) => {
    if (kernelEnabled && kernelMode === 'local-test' && win && event.sender.id === win.webContents.id) getKernel().enqueue('click')
  })
  ipcMain.on('shell:editor', () => openEditorPage())
  ipcMain.on('shell:settings', () => openChild('settings', {
    file: 'settings.html',
    width: 432, height: 760, minWidth: 360, minHeight: 420,
    title: '设置 · Live2D Stage',
  }))
  // ---------- 设置窗口 / 编辑台 → 舞台窗口的 RPC ----------
  // 设置窗口不重复加载模型：它只发指令、拿快照，真正的状态都在舞台窗口里。
  ipcMain.handle('stage:rpc', (_e, op, payload) => callStageRpc(op, payload))
  ipcMain.on('win:center', () => {
    if (!win) return
    const { workArea } = screen.getPrimaryDisplay()
    const [w, h] = win.getSize()
    win.setPosition(Math.round(workArea.x + (workArea.width - w) / 2), Math.round(workArea.y + (workArea.height - h) / 2))
  })
  // 透明处穿透：渲染层拿 alpha 掩码判定指针在不在角色身上，不在就忽略鼠标
  // （forward: true 保证忽略鼠标时仍能收到 mousemove，挪回角色身上可以自己收回来）
  ipcMain.on('win:pass-through', (_e, v) => {
    if (dynamicIgnore !== !!v) console.log(`[pass] 忽略鼠标=${!!v}`)
    dynamicIgnore = !!v
    applyWindowSettings()
  })
  ipcMain.on('shell:quit', () => app.quit())
  // 引擎/核心设置改完，从设置窗口一键重建舞台
  ipcMain.on('shell:restart-engine', () => { restartStage() })
  ipcMain.on('shell:devtools', () => win?.webContents.toggleDevTools())
}

// 全局光标 → 渲染层。跟随要覆盖整个桌面，所以不能只靠窗口内的 mousemove；
// 33ms 轮询 + 变化才发，空闲时零开销。
let cursorTimer = null
function startCursorFeed() {
  if (cursorTimer) return
  let last = null
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    if (last && p.x === last.x && p.y === last.y) return
    last = p
    const [wx, wy] = win.getPosition()
    win.webContents.send('cursor:pos', { x: p.x - wx, y: p.y - wy })
  }, 33)
}
function stopCursorFeed() {
  if (cursorTimer) clearInterval(cursorTimer)
  cursorTimer = null
}

// ---------- 首次运行引导 ----------
// 发布包不带模型（版权原因），所以「刚解压、还没放模型」是最常见的第一种状态。
// 这里不再弹系统文件框然后闪退，而是开一个小窗口把话说清楚：模型要自己放。
async function createFirstRunWindow(error = '') {
  wireFirstRunIpc()
  win = new BrowserWindow({
    width: 640, height: 600,
    minWidth: 520, minHeight: 480,
    backgroundColor: '#11151c',
    title: '第一次运行 · 把模型放进来',
    icon: path.join(ROOT, 'assets', 'app.ico'),
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'app', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 同 openChild：沙箱会让 preload 的 require('node:path') 失败，整个引导页就没有 shell
      sandbox: false,
    },
  })
  win.once('ready-to-show', () => {
    // 引导是一次性的设置窗口：置顶 + 抢焦点，否则开在别的窗口后面等于「双击没反应」
    try { win.setAlwaysOnTop(true, 'screen-saver') } catch {}
    win.show()
    try { win.focus(); win.moveTop() } catch {}
    setTimeout(bootFinished, 2000)
  })
  win.setMenuBarVisibility(false)
  win.on('closed', () => { win = null; bootGuard = false; try { app.quit() } catch {} })
  await win.loadFile(path.join(ROOT, 'app', 'firstrun.html'))
  if (error) {
    try {
      await win.webContents.executeJavaScript(
        `window.__firstRunError && window.__firstRunError(${JSON.stringify(String(error))})`,
        true,
      )
    } catch {}
  }
}

// 引导页用到的三个动作：看路径、打开目录、选定模型（选完重启生效）
let firstRunIpcReady = false
function wireFirstRunIpc() {
  if (firstRunIpcReady) return
  firstRunIpcReady = true
  ipcMain.handle('firstrun:paths', () => ({
    logFile: LOG_FILE,
    logDir: LOG_DIR,
    modelDir: MODEL_DIRS[0],
    exeDir: EXE_DIR,
    version: app.getVersion(),
  }))
  ipcMain.handle('firstrun:open', async (_e, what = 'model') => {
    const dir = what === 'log' ? LOG_DIR : what === 'exe' ? EXE_DIR : MODEL_DIRS[0]
    try { mkdirSync(dir, { recursive: true }) } catch {}
    const err = await shell.openPath(dir)
    if (err) { try { shell.showItemInFolder(LOG_FILE) } catch {} }
    return { ok: !err, error: err || null, path: dir }
  })
  ipcMain.handle('firstrun:set-model', async (_e, p) => {
    const abs = String(p || '').trim().replace(/^"|"$/g, '')
    if (!abs || !existsSync(abs)) return { ok: false, error: '这个路径不存在：' + abs }
    if (!abs.toLowerCase().endsWith('.model3.json')) return { ok: false, error: '请选 .model3.json 文件（不是 moc3）' }
    settings.model = abs
    await saveSettings()
    flog('[firstrun] 选定模型：', abs)
    setTimeout(() => { app.relaunch(); app.exit(0) }, 150)
    return { ok: true, model: abs }
  })
  ipcMain.handle('firstrun:choose', async () => {
    const r = await dialog.showOpenDialog(win || undefined, {
      title: '选择 Live2D 模型（.model3.json）',
      properties: ['openFile'],
      filters: [{ name: 'Live2D 模型', extensions: ['model3.json'] }],
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false }
    settings.model = r.filePaths[0]
    await saveSettings()
    flog('[firstrun] 选择模型：', settings.model)
    setTimeout(() => { app.relaunch(); app.exit(0) }, 150)
    return { ok: true, model: settings.model }
  })
}

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  // 桌宠不装箱单式菜单：引导窗口带边框，默认菜单会在顶上露一条 File/Edit/View
  try { Menu.setApplicationMenu(null) } catch {}
  await loadSettings()
  // 启动时对齐一次系统登录项：设置里开着就补注册（历史版本从没调用过），关着就清掉
  applyAutoStart()
  flog('[boot]', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    exe: process.execPath,
    userData: app.getPath('userData'),
    modelDirs: MODEL_DIRS,
    safeMode: SAFE,
    crashLastTime,
    tries: bootTries,
  })
  settings.model = await resolveModelOrPick()
  if (!settings.model) {
    flog('[boot] 未找到模型 → 首次运行引导')
    await createFirstRunWindow()
    return
  }
  // 预检不过 → 别开空气窗口，带着原因回到引导页（并清掉坏路径，让 model/ 兜底能生效）
  const pre = validateModelBasic(settings.model)
  if (!pre.ok) {
    flog('[boot] 模型预检失败 → 引导', settings.model, pre.error)
    const bad = settings.model
    settings.model = null
    await saveSettings()
    await createFirstRunWindow(`上次挂载的模型加载不了：${pre.error}\n（原路径：${bad}）`)
    return
  }
  flog('[boot] 模型：', settings.model)
  // 贴图过大 → 自动压一次（默认流程）。已经压过、或用 STAGE_NO_SHRINK 跳过的不重复
  if (!process.env.STAGE_NO_SHRINK && !/_opt\d+/i.test(settings.model || '')) {
    const big = oversizedTexture(settings.model)
    if (big) {
      flog('[opt] 发现超大贴图', big.rel, `${big.w}x${big.h}`)
      const ok = await autoShrinkTextures(settings.model)
      if (ok) { await loadSettings(); flog('[opt] 压缩完成，改用：', settings.model) }
      else flog('[opt] 压缩失败，继续用原模型（内存会偏高）')
    }
  }
  // 系统 / 显卡：排查「他那边打不开」时最有用的两行
  try {
    const gpu = await app.getGPUInfo('basic')
    flog('[sys]', {
      os: process.getSystemVersion(), arch: process.arch, electron: process.versions.electron,
      gpu: (gpu?.gpuDevice || []).map((d) => `${d.vendorString || d.vendorId || '?'} ${d.deviceString || ''}`.trim()),
      gl: gpu?.auxAttributes?.glRenderer || null,
    })
  } catch (e) { flog('[sys] GPU 信息读取失败', String(e?.message || e)) }
  await saveSettings()
  try {
    srv = await createStageServer({
      root: ROOT, model: settings.model, token, port: 0,
      integrationDir: path.join(app.getPath('userData'), 'integration'),
      readActions: readActionsFile,
      writeActions: writeActionsFile,
      stageRpc: callStageRpc,
    })
  } catch (e) {
    flog('[boot] 静态服务启动失败', e?.stack || String(e))
    dialog.showErrorBox('启动失败', `本地服务没起来：\n${e?.message || e}\n\n日志：${LOG_FILE}`)
    app.quit()
    return
  }
  await writeEndpoint()
  console.log(`[stage] ${srv.url}/app/  （窗口尺寸 A=${settings.width}×${settings.height}）`)
  wireIpc()
  wireFit()
  wireZoom()
  wireBorderDrag()
  wireWindowDrag()
  startCursorFeed()
  await createWindow()
  // 托盘：舞台窗口不进任务栏，日常入口都在这里
  createTray()
  win.on('show', () => refreshTrayMenu())
  win.on('hide', () => refreshTrayMenu())
  // 退出时把托盘图标一起收掉，否则系统托盘里会留一个点不动的幽灵图标；
  // 顺手同步落一次配置 —— 异步写不保证在进程退出前完成，会把 settings.json 留成 0 字节。
  app.on('before-quit', () => {
    companionKernel?.close()
    chatAuth?.cancel()
    try { tray?.destroy?.(); tray = null } catch {}
    saveSettingsSync()
  })
  bootGuard = false
  // 详细显卡名要等 GPU 进程（'complete' 会阻塞），放到窗口起来之后补记，不挡启动
  setTimeout(async () => {
    try {
      const full = await app.getGPUInfo('complete')
      const d = (full?.gpuDevice || [])[0] || {}
      flog('[sys] gpu:', `${d.vendorString || ''} ${d.deviceString || ''}`.trim() || '未知', 'driver:', d.driverVersion || '?', 'features:', app.getGPUFeatureStatus())
    } catch (e) { flog('[sys] gpu 详情读取失败', String(e?.message || e)) }
  }, 3000)

  // 穿透态找回 / 退出：全局快捷键，即使窗口在忽略鼠标也能用
  globalShortcut.register('Control+Alt+L', () => {
    settings.clickThrough = !settings.clickThrough
    applyWindowSettings()
    saveSettings()
    win?.webContents.send('shell:click-through', settings.clickThrough)
  })
  globalShortcut.register('Control+Alt+Q', () => app.quit())

  app.on('activate', () => { if (!win) createWindow() })
})

app.on('window-all-closed', () => {
  // 启动阶段还会开临时窗口（压缩贴图的 splash）：它关掉不代表程序该退出
  if (bootGuard) return
  // 重启引擎时会先销毁舞台再重建：这段空窗期不能当成「用户关了程序」
  if (restarting) return
  stopCursorFeed()
  globalShortcut.unregisterAll()
  srv?.close?.()
  app.quit()
})
