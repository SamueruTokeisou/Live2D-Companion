/**
 * 一键出发布包：打包 → 压缩 → 校验值 → 打印清单。
 *
 * 为什么单独写一个：这几步手工做每次都踩同样的坑（都实测过）：
 *   1. 还在运行的实例锁着 dist，`EBUSY: unlink ...icudtl.dat` —— 所以先关实例；
 *   2. `tar -a` 写 zip 是**仅存储**（432MB 目录打出 425MB，7-Zip 只有 151MB）—— 所以用 7-Zip；
 *   3. 打完别忘了更新 SHA256SUMS.txt —— 所以一起做掉。
 *
 * 用法：
 *   node scripts/release.mjs                 # 只打发布版（不含模型）
 *   node scripts/release.mjs --full          # 额外打完整版（内置模型，需 STAGE_MODEL_SRC）
 *   node scripts/release.mjs --version 1.1.0 # 顺便把 package.json 版本号改掉
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const wantFull = args.includes('--full')
const vIdx = args.indexOf('--version')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const version = vIdx > 0 ? args[vIdx + 1] : pkg.version
if (vIdx > 0 && version !== pkg.version) {
  pkg.version = version
  writeFileSync(path.join(ROOT, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  console.log('[release] 版本号 →', version)
}

const SEVEN_ZIP = ['C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe'].find((p) => existsSync(p))

function sh(cmd, argv, opts = {}) {
  console.log('[release]', cmd, argv.join(' '))
  const r = spawnSync(cmd, argv, { stdio: 'inherit', cwd: ROOT, ...opts })
  if (r.status !== 0) throw new Error(`${cmd} 失败（exit ${r.status}）`)
}

// ① 关掉正在运行的实例（否则 dist 被锁）
for (const img of ['大肥鱼Live2d桌宠.exe', 'Live2DStage.exe']) {
  spawnSync('taskkill', ['/F', '/IM', img], { stdio: 'ignore' })
}

// ② 打包
sh('npm', ['run', 'pack'], { shell: true, env: { ...process.env } })

// ③ 压缩 + 校验
const targets = [
  { dir: '大肥鱼Live2d桌宠-发布版-win32-x64', zip: `dafeiyu-live2d-pet-v${version}-win32-x64.zip` },
]
if (wantFull) targets.push({ dir: '大肥鱼Live2d桌宠-win32-x64', zip: `dafeiyu-live2d-pet-v${version}-full-win32-x64.zip` })

// ③.5 插件包 / 源码包（不在 dist 里，单独压）
const extras = []
const bridgeDir = path.resolve(ROOT, '..', 'dsh-live2d-bridge')
if (existsSync(path.join(bridgeDir, 'package.json'))) {
  const bpkg = JSON.parse(readFileSync(path.join(bridgeDir, 'package.json'), 'utf8'))
  extras.push({
    zip: `dsh-live2d-bridge-v${bpkg.version}.zip`,
    cwd: bridgeDir,
    entries: ['lib', 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE'],
  })
} else {
  console.warn('[release] 跳过插件包：没找到', bridgeDir)
}
extras.push({
  zip: `live2d-stage-src-v${version}.zip`,
  cwd: ROOT,
  entries: ['.'],
  // 源码包：可重建即可，不带依赖/构建产物/模型/旧发布
  exclude: [
    '-xr!node_modules', '-xr!dist', '-xr!release', '-xr!tmp', '-xr!.git',
    '-xr!model', '-xr!vendor8', '-xr!*.log', '-xr!*.zip',
  ],
})

const sums = []
for (const t of targets) {
  const src = path.join(ROOT, 'dist', t.dir)
  if (!existsSync(src)) throw new Error(`没找到 ${src}`)
  const out = path.join(ROOT, 'release', t.zip)
  rmSync(out, { force: true })
  if (!SEVEN_ZIP) throw new Error('没找到 7z.exe，别用 tar（会打成仅存储）')
  sh(SEVEN_ZIP, ['a', '-tzip', '-mx=5', '-mfb=128', '-bd', out, t.dir], { cwd: path.join(ROOT, 'dist') })
  const h = createHash('sha256').update(readFileSync(out)).digest('hex')
  const mb = (statSync(out).size / 1024 / 1024).toFixed(0)
  sums.push(`${h}  ${t.zip}`)
  console.log(`[release] ${t.zip}  ${mb} MB  sha256=${h}`)
}

for (const e of extras) {
  const out = path.join(ROOT, 'release', e.zip)
  rmSync(out, { force: true })
  if (!SEVEN_ZIP) throw new Error('没找到 7z.exe')
  sh(SEVEN_ZIP, ['a', '-tzip', '-mx=5', '-mfb=128', '-bd', out, ...e.entries, ...(e.exclude || [])], { cwd: e.cwd })
  const h = createHash('sha256').update(readFileSync(out)).digest('hex')
  const kb = (statSync(out).size / 1024).toFixed(0)
  sums.push(`${h}  ${e.zip}`)
  console.log(`[release] ${e.zip}  ${kb} KB  sha256=${h}`)
}

// ④ 更新 SHA256SUMS.txt（保留其它条目，替换同名；旧的无版本插件包行一起清掉）
const sumFile = path.join(ROOT, 'release', 'SHA256SUMS.txt')
const old = existsSync(sumFile) ? readFileSync(sumFile, 'utf8').split('\n').filter(Boolean) : []
const fresh = new Set([...targets.map((t) => t.zip), ...extras.map((e) => e.zip)])
const kept = old.filter((line) => {
  const name = line.trim().split(/\s+/).pop()
  if (name === 'dsh-live2d-bridge.zip') return false   // 旧的无版本名，已由新包替代
  return !fresh.has(name)
})
writeFileSync(sumFile, `${[...kept, ...sums].join('\n')}\n`)
console.log('[release] 已更新 release/SHA256SUMS.txt')
console.log('[release] 完成。发布说明记得同步 release/发布说明.md')
