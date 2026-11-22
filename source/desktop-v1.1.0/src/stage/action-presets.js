/**
 * 动作预设：把舞台里内置的「姿势」和「待机动作」翻译成编辑器能直接编辑的动作条目。
 *
 * 目的：左栏不应该只有用户自己新建的动作 —— 内置的那些（举手/竖手指/狗尾草、
 * 重心换脚/东张西望/伸懒腰…）也应该能点开、拖参数、实时看效果，
 * 这样任何人都能照着改，不用先去读代码。
 *
 * 两套来源的语义不同，转换规则：
 *   · poses.js 的 POSES 是**绝对终点值** → 直接作为关键帧值；
 *   · idle-motions.js 的 ROUTINES 是**相对增量的归一化曲线**（0..1 时间）→
 *     采样成毫秒关键帧，值直接当绝对值用（站立时增量基准≈0，视觉上一致）。
 */

import { POSES } from './poses.js'
import { ROUTINES } from './idle-motions.js'

const REST = {
  Movement1: 0, Movement2: 0, Movement3: 0,
  Param56: 1, Param57: 0,
  Param36: 0, Param39: 0, Param40: 0, Param41: 0, Param42: 0, Param43: 0,
  Param59: 0, Param60: 0, Param61: 0, Param62: 0,
}

/** 采样一条归一化曲线 → [{t, v}]，每 8% 取一个点，首尾必取 */
function sampleTrack(keys, ms, steps = 12) {
  if (!Array.isArray(keys) || !keys.length) return []
  const out = []
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps
    out.push({ t: Math.round(p * ms), v: sampleAt(keys, p) })
  }
  return out
}

function sampleAt(keys, p) {
  if (p <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, v1] = keys[i]
    if (p <= t1) {
      const [t0, v0] = keys[i - 1]
      const span = t1 - t0 || 1
      const k = Math.min(1, Math.max(0, (p - t0) / span))
      const e = k * k * (3 - 2 * k)
      return v0 + (v1 - v0) * e
    }
  }
  return keys[keys.length - 1][1]
}

/** POSES → 动作：单关键帧（终点姿势），时长够看就行 */
function poseActions() {
  return Object.entries(POSES).map(([name, p]) => {
    const values = { ...REST, ...(p.params || {}), ...(p.extras || {}) }
    return {
      id: `preset:pose:${name}`,
      name,
      trigger: 'manual',
      preset: 'pose',
      duration: 420,
      lines: [],
      params: Object.keys(values),
      keys: [{ t: 0, values }],
    }
  })
}

/** ROUTINES → 动作：把归一化增量曲线采样成毫秒关键帧 */
function routineActions() {
  return Object.entries(ROUTINES || {}).map(([name, r]) => {
    // 动作自带的姿势族（狗尾草 / 竖手指）：作为基底参数每帧写，和舞台的 pose 层同义
    const poseDef = r.pose ? POSES[r.pose] : null
    const base = poseDef ? { ...REST, ...(poseDef.params || {}), ...(poseDef.extras || {}) } : null
    const tracks = { ...(r.tracks || {}) }
    // `arms` 是「相对姿势基线的偏移」：舞台交给 poses.tune 叠，编辑台没有那层，
    // 所以这里换算成绝对值并进关键帧 —— 不这么做的话「挥挥手 / 杂鱼晃手」在预览里
    // 只有身体在晃、手臂纹丝不动，看着就像手部动作丢了。
    for (const [id, curve] of Object.entries(r.arms || {})) {
      if (!Array.isArray(curve)) continue
      const baseVal = Number(base?.[id] ?? REST[id] ?? 0)
      tracks[id] = curve.map(([t, v]) => [t, baseVal + v])
    }
    const ids = Object.keys(tracks)
    const ms = Math.max(200, Math.round(r.ms || 3000))
    const byTime = new Map()
    for (const id of ids) {
      for (const { t, v } of sampleTrack(tracks[id], ms)) {
        if (!byTime.has(t)) byTime.set(t, {})
        byTime.get(t)[id] = Number(v.toFixed(4))
      }
    }
    const keys = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, values]) => ({ t, values }))
    return {
      id: `preset:idle:${name}`,
      name,
      trigger: 'manual',
      preset: 'idle',
      // 情绪配方（傲娇/害羞…）和普通待机动作分开列：它们只该被点名，不该进随机池
      emotion: !!r.emotion,
      duration: ms,
      lines: Array.isArray(r.lines) ? r.lines.slice() : [],
      params: ids,
      keys: keys.length ? keys : [{ t: 0, values: {} }],
      // 物理输出参数（LEGAngleZ2 / Param44 / LeanInput 这类）只能在物理之后写，
      // 舞台用 holds 层，编辑台也照这个语义存。
      // ⚠️ 存的是**归一化曲线**（[[t,v],...]），编辑台按当前时间采样后再写 ——
      //    直接当数值写就是 NaN，整条物理链会坏，头/头发会直接画没。
      holds: { ...(r.holds || {}) },
      base,
    }
  })
}

// ---------------- 用户动作包（扩展接口，见 docs/EXTENDING.md） ----------------
const packs = new Map()

function normalizeAction(a, pack, i) {
  if (!a || !Array.isArray(a.keys) || !a.keys.length) return null
  const keys = a.keys
    .map((k) => ({ t: Math.max(0, Number(k?.t) || 0), values: { ...(k?.values || {}) } }))
    .sort((x, y) => x.t - y.t)
  const id = String(a.id || `${pack.id}:${a.name || i}`)
  const params = Array.isArray(a.params) && a.params.length
    ? a.params.map(String)
    : [...new Set(keys.flatMap((k) => Object.keys(k.values)))]
  return {
    id,
    name: String(a.name || id),
    trigger: a.trigger || 'manual',
    preset: a.preset || 'custom',
    duration: Math.max(120, Number(a.duration) || (keys[keys.length - 1].t + 120)),
    lines: Array.isArray(a.lines) ? a.lines.slice() : [],
    params,
    keys,
    holds: { ...(a.holds || {}) },
    base: a.base ? { ...a.base } : null,
    emotion: !!a.emotion,
    pack: pack.id,
  }
}

/**
 * 注册一个动作包。
 * @param {{ id: string, name?: string, actions: Array<object> | (() => Array<object>) }} pack
 * 动作条目：{ id?, name, duration, keys:[{t, values:{参数: 值}}], params?, lines?, holds?, base? }
 * 同名动作会**替换**内置那条（换成自己的动作链），不同名则追加到左栏末尾。
 */
export function registerActionPack(pack) {
  if (!pack || !pack.id) throw new TypeError('registerActionPack: 需要 { id, actions }')
  const raw = typeof pack.actions === 'function' ? pack.actions() : pack.actions
  const actions = (Array.isArray(raw) ? raw : []).map((a, i) => normalizeAction(a, pack, i)).filter(Boolean)
  const id = String(pack.id)
  packs.set(id, { id, name: String(pack.name || id), actions })
  return id
}

export function unregisterActionPack(id) { return packs.delete(String(id)) }

export function listActionPacks() {
  return [...packs.values()].map((p) => ({ id: p.id, name: p.name, count: p.actions.length }))
}

/** 全部预设：内置（姿势 → 待机）+ 用户动作包；同 id 或同名时用户包覆盖内置 */
export function allPresetActions() {
  const byId = new Map([...poseActions(), ...routineActions()].map((a) => [a.id, a]))
  const nameToId = new Map([...byId.values()].map((a) => [a.name, a.id]))
  for (const p of packs.values()) {
    for (const a of p.actions) {
      const replaced = nameToId.get(a.name)
      if (replaced && replaced !== a.id) byId.delete(replaced)   // 同名 = 替换内置动作链
      byId.set(a.id, a)
    }
  }
  return [...byId.values()]
}
