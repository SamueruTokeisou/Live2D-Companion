/**
 * 扩展接口注册表（第三方 / 自己魔改用的公共入口）。
 *
 * 目标：不用改本仓库的任何源文件，也能换掉「口型驱动」和「动作链」。
 *   · 口型：TTS 引擎、音频 analyser、自己的唇形算法 → registerLipSync() + useLipSync()
 *   · 动作：自定义动作包（关键帧 or 直接替换内置同名动作）→ registerActionPack()
 *
 * 两种用法：
 *   1) 运行时：页面加 `?ext=/extensions/我的扩展.js`，文件里直接 `window.Live2DStage.registerLipSync(...)`；
 *   2) 嵌入：`import { registerLipSync, useLipSync } from './src/stage/extensions.js'`
 *
 * 设计上的取舍：注册表只存「定义」，真正的 provider 在 useLipSync() 时才 instantiate，
 * 这样扩展文件可以先加载（哪怕舞台还没起来），也不会因为嘴还没建好而报错。
 */

import { registerActionPack, unregisterActionPack, listActionPacks } from './action-presets.js'

const lipSyncs = new Map()
let activeLipSyncId = null
let ctx = {
  mouth: null,
  stage: null,
  log: (...a) => console.log('[ext]', ...a),
}

/** 舞台就绪后由 renderer 调用：把嘴/舞台交给扩展层 */
export function bindExtensionContext(next = {}) {
  ctx = { ...ctx, ...next }
  return ctx
}

/**
 * 注册一个口型驱动。
 * @param {{
 *   id: string, name?: string,
 *   create: (ctx: {mouth: any, stage: any, log: Function}) => {
 *     frame?: (dtMs: number, info: {t: number, level: number, open: number}) => number | {
 *       open?: number, form?: number, funnel?: number, pucker?: number, jaw?: number
 *     } | null,
 *     speakText?: (text: string, opts?: {rate?: string|number}) => number | void,
 *     stop?: () => void,
 *   }
 * }} def
 */
export function registerLipSync(def) {
  if (!def || !def.id) throw new TypeError('registerLipSync: 需要 { id, create(ctx) }')
  const id = String(def.id)
  lipSyncs.set(id, {
    id,
    name: String(def.name || id),
    create: typeof def.create === 'function' ? def.create : () => def,
  })
  return id
}

export function listLipSyncs() {
  return [...lipSyncs.values()].map((d) => ({ id: d.id, name: d.name, active: d.id === activeLipSyncId }))
}

/**
 * 启用某个口型驱动。provider 的 frame() 返回数字 = 能量 0..1，返回对象 = 直接给口型形状，
 * 返回 null = 这一帧交给内置口型（所以可以只在一句话期间接管）。
 */
export function useLipSync(id) {
  if (!ctx.mouth) throw new Error('useLipSync: 舞台还没就绪（等 Live2DStage 出现后再调）')
  const def = lipSyncs.get(String(id))
  if (!def) throw new Error(`useLipSync: 没有注册过 "${id}"`)
  const provider = def.create({ ...ctx }) || null
  // 给 provider 打个标记：诊断/故障报告里能看出「现在是谁在驱动嘴」
  if (provider && !provider.id) provider.id = def.id
  ctx.mouth.setProvider(provider)
  activeLipSyncId = def.id
  return def.id
}

/** 交还内置口型（TTS 说完、或想恢复原生音节驱动时调） */
export function clearLipSync() {
  ctx.mouth?.setProvider?.(null)
  activeLipSyncId = null
}

/**
 * 加载用户扩展文件（`?ext=a.js,b.js` 走这条）。
 * 加载失败只告警，不影响舞台本身 —— 扩展是可选件，不能把主程序拖垮。
 */
export async function loadUserExtensions(urls = []) {
  const list = (Array.isArray(urls) ? urls : String(urls).split(','))
    .map((s) => String(s).trim())
    .filter(Boolean)
  const out = []
  for (const u of list) {
    try {
      await import(/* webpackIgnore: true */ u)
      out.push({ url: u, ok: true })
    } catch (e) {
      console.warn('[ext] 加载失败', u, e)
      out.push({ url: u, ok: false, error: String(e?.message || e) })
    }
  }
  return out
}

export { registerActionPack, unregisterActionPack, listActionPacks }
export const EXTENSION_API_VERSION = 1
