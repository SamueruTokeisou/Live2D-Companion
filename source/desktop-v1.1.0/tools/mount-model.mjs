#!/usr/bin/env node
/**
 * mount-model —— 脚本化「挂载模型」：校验 .model3.json 并把路径写进设置文件。
 *
 * 为什么不靠 GUI：弹窗选择在不同机器/自动化环境里不稳定，
 * 写一份确定的 settings.json 才是可复现的挂载方式。
 *
 * 用法：
 *   node tools/mount-model.mjs "D:\模型\大肥鱼.model3.json"
 *   node tools/mount-model.mjs "..." --home "D:\便携配置"
 *
 * 退出码：0 成功；1 模型不完整；2 用法错误。
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

// Windows 控制台默认 936，Node 的 stdout 是 UTF-8 —— 不切页面，中文会全变乱码。
// 只切本进程所在的 TTY；父批处理在调用结束后会 chcp 936 切回去。
if (process.platform === 'win32' && process.stdout.isTTY) {
  try { execSync('chcp 65001', { stdio: 'ignore' }) } catch {}
}

const argv = process.argv.slice(2)
const flags = {}
const pos = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const k = a.slice(2)
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
    flags[k] = v
  } else pos.push(a)
}

/**
 * 配置目录：挂载只会写这里。提前算出来，好让日志从第一行就能落盘。
 * 诊断报告会收集 logs/*.log —— 「挂载没反应」时 AI 拿这一份就能看出卡在哪。
 */
const home = flags.home || process.env.STAGE_HOME || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'live2d-stage')
function mlog(s) {
  try {
    mkdirSync(path.join(home, 'logs'), { recursive: true })
    appendFileSync(path.join(home, 'logs', 'mount.log'), `[${new Date().toISOString()}] ${s}\n`, 'utf8')
  } catch {}
}
mlog(`argv=${JSON.stringify(argv)}`)

const modelArg = pos[0]
if (!modelArg) {
  mlog('失败：没有路径参数')
  console.error('用法：node tools/mount-model.mjs <路径\\xxx.model3.json> [--home <配置目录>]')
  process.exit(2)
}

/**
 * 清掉粘贴/拖拽留下的包装：
 *   - Windows 资源管理器「复制文件地址」会给整条路径加一对引号（"D:\\model\\x.model3.json"），
 *     以前直接 path.resolve 会变成「D:\\当前目录\\"D:\\...」→ 报「找不到模型文件」；
 *   - 前后空格、BOM、file:// 前缀也一并处理。
 */
function cleanArg(s) {
  let v = String(s ?? '').replace(/^\uFEFF/, '').trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim()
  }
  if (/^file:\/\//i.test(v)) {
    try { v = fileURLToPath(v) } catch {}
  }
  return v
}

const modelRaw = cleanArg(modelArg)
const model = path.resolve(modelRaw)
if (!existsSync(model)) {
  mlog(`失败：找不到模型文件 ${model}（原始参数 ${JSON.stringify(modelArg)}）`)
  console.error(`[mount] 找不到模型文件：${model}`)
  if (/["']/.test(modelRaw)) console.error('[mount] 提示：路径里不要带引号，直接拖文件或粘贴不带引号的完整路径。')
  process.exit(1)
}

/** 校验 model3.json 引用的 moc3 / 贴图是否齐全（缺文件在别的机器上就是黑屏） */
function validate(file) {
  const dir = path.dirname(file)
  let json
  try { json = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
    return { ok: false, error: `model3.json 不是合法 JSON：${e.message}` }
  }
  const fr = json.FileReferences || {}
  const missing = []
  const check = (p) => { if (!p) return; const abs = path.resolve(dir, p); if (!existsSync(abs)) missing.push(p) }
  check(fr.Moc)
  check(fr.Physics)
  check(fr.DisplayInfo)
  for (const t of fr.Textures || []) check(t)
  for (const e of fr.Expressions || []) check(e.File)
  for (const group of Object.values(fr.Motions || {})) for (const x of group) check(x.File)
  return { ok: missing.length === 0, missing, dir }
}

const v = validate(model)
if (!v.ok && v.error) {
  mlog(`失败：${v.error}`)
  console.error(`[mount] ${v.error}`)
  process.exit(1)
}

mkdirSync(home, { recursive: true })
const file = path.join(home, 'settings.json')
let settings = {}
try { settings = JSON.parse(readFileSync(file, 'utf8')) } catch {}

// 模型在 exe 旁边的 model/ 里时只存相对路径（换目录/换机不用改配置），其余情况存绝对路径
const EXE_DIR = path.dirname(process.execPath)
const rel = path.relative(EXE_DIR, model)
const stored = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : model
settings.model = stored
writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8')

// 回读校验：配置里存的路径必须能解析回模型文件（防编码损坏把中文写坏）
const back = JSON.parse(readFileSync(file, 'utf8')).model
const backAbs = path.isAbsolute(back) ? back : path.resolve(EXE_DIR, back)
if (path.resolve(backAbs) !== path.resolve(model)) {
  mlog(`失败：写入校验不通过 back=${back} file=${file}`)
  console.error(`[mount] 写入校验失败：${file} 里的路径解析不回模型文件（可能是编码问题）`)
  process.exit(1)
}

console.log(`[mount] 模型：${model}`)
console.log(`[mount] 配置：${file}（记录为 ${back}）`)
if (v.missing?.length) {
  mlog(`失败：缺少 ${v.missing.length} 个引用文件 ${JSON.stringify(v.missing.slice(0, 10))}`)
  console.warn(`[mount] 警告：缺少 ${v.missing.length} 个引用文件，角色可能显示不全：`)
  for (const m of v.missing.slice(0, 10)) console.warn('  - ' + m)
  process.exit(1)
}
mlog(`成功：model=${model} stored=${back} file=${file}`)
console.log('[mount] 校验通过 ✅')
console.log('[mount] 重启桌宠后生效（挂载只写配置，不会热更新正在运行的窗口）')

// 正在运行的话，直接告诉用户「为什么看起来没反应」——比让他自己猜强
try {
  const epFile = path.join(os.homedir(), '.dsh', 'live2d', 'endpoint.json')
  const ep = JSON.parse(readFileSync(epFile, 'utf8'))
  if (ep?.pid) {
    try { process.kill(Number(ep.pid), 0); console.log(`[mount] 检测到桌宠正在运行（pid ${ep.pid}）：请先退出，再重新打开。`) } catch {}
  }
} catch {}
