import { createConversationAdapter } from './kernel/conversation-adapter.mjs'
import { installBodyPort } from './kernel/body-port.mjs'
// Live2D Stage —— 应用渲染层（透明窗口里的角色）。
// 只做「角色 + 互动 + 设置」，验证台的调试面板不在这里。
// 引擎分支：?engine=pixi7 用 pixi7 + mulmotion（乘法色分支，实测快一倍），默认走 pixi8 内核
const __ENGINE = new URLSearchParams(location.search).get('engine') === 'pixi7' ? 'pixi7' : 'default'

// ?core=native：用原生 Cubism Core（N-API 桥）替换 WASM 版。
// 必须在引擎模块加载前装好全局 Live2DCubismCore，engine.js 的 loadCore 会直接复用。
const __CORE = new URLSearchParams(location.search).get('core') || 'wasm'
if (__CORE === 'native') {
  try {
    const root = window.shell?.paths?.root || ''
    const core = window.__installNativeCore(
      root ? { dllPath: `${root}/native/cubism-core/vendor/Live2DCubismCore.dll` } : {},
    )
    console.log('[core] native', core.__info.versionString, 'moc<=', core.__info.latestMocVersion)
  } catch (e) {
    // 原生模块加载失败也不能白屏：回退到 WASM 版（engine.loadCore 会自己补上）
    console.error('[core] 原生核心不可用，回退 WASM：', e?.message || String(e))
  }
}

const eng = await import(__ENGINE === 'pixi7' ? '../src/stage/engine-pixi7.js' : '../src/stage/engine.js')
const { createStage } = eng
/**
 * 部件/参数名统一取法。
 * pixi8（untitled）给的是 `{ getString(): { s } }`，pixi7（cubism4mul）直接给字符串。
 * 以前到处写 `.getPartId(i).getString().s`：pixi7 下这一步抛异常、被 try/catch 吞成 ''，
 * 于是 seedRegions 拿不到任何部件名 → 热区 0 个、互动全没了（只在 pixi7 分支复现）。
 */
const csmName = eng.csmText || ((h) => (h && typeof h.getString === 'function' ? h.getString().s : String(h ?? '')))
import { createLayerStack } from '../src/stage/layers.js'
import { createViewport } from '../src/stage/viewport.js'
import { createGaze } from '../src/stage/gaze.js'
import { createPoseBus } from '../src/stage/pose-bus.js'
import { createIdleMotions, ROUTINES } from '../src/stage/idle-motions.js'
import { createHistory } from '../src/stage/history.js'
import { createMood, moodForTouch } from '../src/stage/mood.js'
import { mouthForAction, mouthOf } from '../src/stage/mouth/presets.js'
import { createTickle } from '../src/stage/tickle.js'
import { createRegionStore, createRegionInput, seedRegions, longSkirtRegion, faceRegions, foreheadRegion, createFaceZoneReader, createHandZoneReader, bandBoxes } from '../src/stage/regions.js'
import { createReactions, DEFAULT_REACTIONS } from '../src/stage/reactions.js'
import { createPetSway } from '../src/stage/pet-sway.js'
import { createFacePinch } from '../src/stage/face-pinch.js'
import { createLife } from '../src/stage/life.js'
import { createMouth } from '../src/stage/mouth.js'
import {
  bindExtensionContext, registerLipSync, registerActionPack, useLipSync, clearLipSync,
  listLipSyncs, listActionPacks, loadUserExtensions,
} from '../src/stage/extensions.js'
import { createFaultLog } from '../src/stage/fault-log.js'
import { createIdleFaces } from '../src/stage/idle-faces.js'
import { createCapture } from '../src/stage/capture.js'
import { createPosture } from '../src/stage/posture.js'
import { createPoses, POSES, OFFICIAL_POSES } from '../src/stage/poses.js'
import { allPresetActions } from '../src/stage/action-presets.js'
import { PHRASES } from '../src/stage/phrases.js'
import { createBubble } from '../src/stage/bubble.js'
import { createAgentLink } from '../src/stage/agent-link.js'
import { createProfiler } from '../src/stage/perf.js'
import { parseIntents, grammarText, VERBS, clampNum } from '../src/stage/agent/intent.js'
import { planGesture, armLinkageFromTune, legChain, GESTURE_NAMES } from '../src/stage/rig/rig.js'
import { EMOTION_NAMES } from '../src/stage/semantics.js'
import { createVariantPicker, weightOf, VARIANTS, registerVariants, listVariants } from '../src/stage/variants.js'

const $ = (s) => document.querySelector(s)
const perf = createProfiler()
const TOGGLE_SET = new Set(['胸口衣服', '裙子切换', '脱鞋', '尾巴开关'])

/**
 * 分区互动时的嘴形（情绪覆盖）。
 * 表情包只驱动眼/脸，嘴由 mouth.js 单独驱动 —— 所以「被摸到哪个部位」的差别主要靠这里表达。
 * 字段是**相对待机嘴的偏移**：open 张开、form 嘴形（负=下撇/嫌弃，正=笑）、smile 嘴角、funnel 圆唇。
 */
const REGION_MOUTH = {
  胸: { open: 0.04, form: -0.45, ms: 2400 },
  腰: { open: 0.42, form: 0.5, smile: 0.8, ms: 2800 },    // 被挠痒：和脚一样忍不住笑
  裙摆: { open: 0.08, form: -0.62, ms: 3200 },          // 嫌弃：嘴角下撇、不情愿地微张嘴
  腿: { open: 0.26, form: 0.10, funnel: 0.30, ms: 2600 }, // 发晕：嘴微微张开、有点呆
  脚: { open: 0.50, form: 0.55, smile: 0.85, ms: 3200 },  // 被挠痒：忍不住笑出来
  头: { open: 0.10, form: 0.22, smile: 0.30, ms: 2200 },
  // 手被碰：小小的不好意思（嘴微微张开、笑意一点点），跟脚那种「被挠痒」区分开
  左手: { open: 0.12, form: 0.26, smile: 0.32, ms: 2000 },
  右手: { open: 0.12, form: 0.26, smile: 0.32, ms: 2000 },
  // 摸到胯：嘴上不情愿（下撇、抿着），配黑脸
  胯: { open: 0.08, form: -0.55, ms: 3600 },
}

/** 浏览器里打开 /app/ 时没有 Electron 预加载：给一套空壳，方便无头验证渲染 */
const shell = window.shell || {
  get: async () => ({ width: 520, height: 760, zoom: 1, gaze: true, strength: 1, alwaysOnTop: false, clickThrough: false }),
  set: async (patch) => patch,
  moveBy: () => {},
  dragBegin: () => {},
  dragEnd: () => {},
  setPassThrough: () => {},
  fit: () => {},
  zoom: () => {},
  openSettings: () => {},
  onSettings: () => {},
  stageRpc: async () => ({ ok: false }),
  center: () => {},
  quit: () => {},
  devtools: () => {},
  openHarness: () => {},
  onClickThrough: () => {},
}

const state = {
  caps: null, stage: null, layers: null, viewport: null, gaze: null,
  store: null, regionInput: null, reactions: null, settings: null,
  mask: null, maskAt: 0, maskPending: false, windowDragging: false, middleDragging: false,
  // 右键拖动搬窗口：记「真的拖过」的时刻，用来区分「右键拖」和「右键点（弹工具栏）」
  rightDragAt: 0, rightDragMoved: 0,
  // 摸尾巴的反应窗口：窗口内的抚摸事件不再打断动作/改台词（手顺着尾巴滑到腿上就会）
  tailPetUntil: 0,
  // 甩尾窗口：{ t0, ms }；由 onBeforeUpdate 最后一步写 HipAngleZ/ParamBodyAngleZ
  tailWag: null,
  /** 本轮意图里挂的表情（没写时长的）：等 T = max(T1,T2) 算完统一退 */
  agentExprs: [],
  ignoring: false, pointerDown: false,
  /** 当前动作在写头部角度 → 鼠标追踪让位（见 onBeforePhysics） */
  yieldHead: false,
  /** 时间序列缓存：动作 / 互动 / 说话 / 表情（见 src/stage/history.js） */
  history: createHistory({ limit: 200 }),
  /** 情绪状态：由互动累积、随时间衰减，给待机选动作加权（见 src/stage/mood.js） */
  mood: createMood(),
  /** 互动差分抽签器：按当前情绪加权挑「这一次怎么反应」（见 src/stage/variants.js） */
  variants: null,
  /** 差分表情 / 自定义参数的到期清理句柄 */
  variantExprHold: 0,
  variantParamHold: 0,
  physics: { inputs: new Set(), outputs: new Set() },
}

function toast(text, ms = 1800) {
  let el = $('#toast')
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el) }
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.classList.remove('show'), ms)
}

// ---------- 姿势兜底收回 ----------
// 手举起来是「黏」的：agent 或互动把它抬上去之后，常常没人负责放下，
// 一只胳膊就那样挂一整天。所以一段时长没有新的姿势指令就自己回默认手。
// 护胸这类需要维持几秒的，用 holdPoseGuard 挡住计时。
let poseAutoTimer = 0
let poseGuardUntil = 0
function holdPoseGuard(ms = 6000) {
  poseGuardUntil = Math.max(poseGuardUntil, performance.now() + Math.max(0, ms))
}
function armPoseAutoRelease(ms) {
  const delay = Number(ms ?? state.settings?.poseHoldMs ?? 11000) || 11000
  clearTimeout(poseAutoTimer)
  const tick = () => {
    const s = state.poses?.state?.()
    if (!s) return
    const hands = s.hands || {}
    const raised = hands.left || hands.right || s.active !== '默认手'
    if (!raised) return
    if (performance.now() < poseGuardUntil) { poseAutoTimer = setTimeout(tick, 2000); return }
    state.poses?.release(700)
  }
  poseAutoTimer = setTimeout(tick, Math.max(1500, delay))
}

// ---------- 性能浮层（F3 开关；统计常驻，探针用 window.__perf.snapshot()） ----------
window.__perf = perf
function bootPerfOverlay() {  state.stage?.ticker?.add?.(() => perf.frame())
  let el = null
  let timer = 0
  const paint = () => {
    if (!el) return
    const s = perf.snapshot(false)
    const row = (k, label) => (s[k] ? `<span>${label} <b>${s[k].avg.toFixed(1)}</b>ms · max ${s[k].max.toFixed(1)} · ${s[k].n}次</span>` : '')
    el.innerHTML = `<b>${s.fps.toFixed(1)} fps</b><br>` +
      row('dt', '帧间隔') + row('pre', '每帧逻辑') + row('pass', '穿透判定') +
      row('mask', '遮罩重建') + row('face', '脸部热区')
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F3') return
    e.preventDefault()
    if (el) { el.remove(); el = null; clearInterval(timer); timer = 0; return }
    el = document.createElement('div')
    el.id = 'perf'
    document.body.appendChild(el)
    timer = setInterval(paint, 250)
    paint()
  })
}

// ---------- 控制总线：agent / 脚本 → 舞台，舞台 → agent ----------
// 下行：SSE /api/events 收动作；上行：POST /api/feedback 报互动、POST /api/snapshot 报状态。
// 舞台不认「agent 是谁」——DSH 插件、命令行、别的脚本走同一个入口。
const BUS_HOLD_MS = 2500

function postJSON(url, body, token) {
  try {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stage-token': token },
      body: JSON.stringify(body),
    }).catch(() => null)
  } catch { return null }
}

/** 上行反馈：只报「真的发生了什么」，悬停/移动不刷日志 */
function emitFeedback(ev, token) {
  if (!token) return
  postJSON('/api/feedback', ev, token)
}

/**
 * 执行一串意图。每条都返回结果 —— 写错的词要能回执给 agent，
 * 它下一轮才知道自己哪里不合规（闭环的另一半就在这回执上）。
 */
function runIntents(intents = []) {
  const out = []
  const push = (verb, ok, detail, error) =>
    out.push({ verb, ok, ...(detail ? { detail } : {}), ...(error ? { error } : {}) })
  const OFF = /^(关|off|0|false|不)$/i
  // 连写多个「看」时按顺序执行（【看|左】【看|右】= 来回转头），不再一次性全写进目标
  let lookCursor = 0
  for (const it of intents) {
    const [a0, a1] = it.args
    try {
      switch (it.verb) {
        case '姿势': {
          const name = String(a0 || '')
          if (!POSES[name]) { push(it.verb, false, null, `没有这个姿势：${name}`); break }
          state.poses?.set(name, clampNum(a1, 0, 3000, 320))
          if (name !== '默认手') armPoseAutoRelease()
          push(it.verb, true, name)
          break
        }
        case '手势': {
          const name = String(a0 || '')
          const base = state.poses?.armBase?.() ?? {}
          const plan = planGesture(name, base)
          if (plan.error) { push(it.verb, false, null, plan.error); break }
          // 先把「哪套图」切过去（poses 负责手臂链插值），再把族内手位叠上去
          state.poses?.set(plan.family, 340)
          if (plan.reach) {
            const off = {}
            for (const [id, v] of Object.entries(plan.reach)) off[id] = v - (base[id] ?? 0)
            state.poses?.tune?.(off, 340)
          }
          state.layers?.removeExpression?.('rig.gesture')
          const rest = plan.params.filter((p) => !(p.id in (plan.reach || {})))
          if (rest.length) {
            state.layers?.addExpression('rig.gesture',
              rest.map((p) => ({ Id: p.id, Value: p.value, Blend: 'Add' })),
              { source: 'rig', fade: 0.28 })
          }
          // 手势是「举着」的：agent 经常说完就不管了，兜底定时收回
          armPoseAutoRelease()
          push(it.verb, true, `${name}（${plan.family}）`)
          break
        }
        case '动作': {
          const name = String(a0 || '').trim()
          if (!name) {
            const rs = state.idle?.routines?.() || []
            const cs = state.idle?.combos?.() || []
            push(it.verb, true, `动作 ${rs.join(' / ')}；组合 ${cs.join(' / ')}`)
            break
          }
          const played = state.idle?.trigger?.(name, { manual: true })
          if (!played) { push(it.verb, false, null, `没有这个动作：${name}`); break }
          push(it.verb, true, played)
          break
        }
        case '情绪': {
          const name = String(a0 || '').trim()
          if (!name) {
            push(it.verb, true, `情绪 ${EMOTION_NAMES.join(' / ')}`)
            break
          }
          if (!EMOTION_NAMES.includes(name)) { push(it.verb, false, null, `没有这个情绪：${name}`); break }
          const played = state.idle?.trigger?.(name, { manual: true })
          if (!played) { push(it.verb, false, null, `情绪没播出来：${name}`); break }
          push(it.verb, true, played)
          break
        }
        case '手': {
          const side = /^(右|右手|right|r)$/i.test(String(a0 || '')) ? 'right' : 'left'
          const wantOn = a1 === undefined ? true : !OFF.test(String(a1))
          const onKey = side === 'right' ? '抚胸' : '竖手指'
          const isOn = (state.poses?.state?.()?.hands || {})[side] === onKey
          if (wantOn !== isOn) state.poses?.toggleHand?.(side)
          armPoseAutoRelease()
          push(it.verb, true, `${side === 'right' ? '右手' : '左手'}${wantOn ? '开' : '关'}`)
          break
        }
        case '表情': {
          const name = String(a0 || '')
          const def = (state.caps?.expressions || []).find((e) => e.name === name)
          if (!def) { push(it.verb, false, null, `没有这个表情：${name}`); break }
          state.layers?.removeSource('bus')
          state.layers?.addExpression(name, def.params, { source: 'bus', fade: 0.25 })
          const ms = Number(a1)
          // 没写时长：先记下来，等这轮算完 T = max(T1,T2) 再统一退（见 speakAgent）
          if (Number.isFinite(ms) && ms > 0) {
            setTimeout(() => { if (state.layers?.hasExpression?.(name)) state.layers.removeExpression(name) }, ms)
          } else {
            state.agentExprs.push({ name })
          }
          push(it.verb, true, name)
          break
        }
        case '看': {
          const MAP = {
            上: [0, -1], 下: [0, 1], 左: [-1, 0], 右: [1, 0], 正前: [0, 0], 前: [0, 0],
            up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], center: [0, 0], front: [0, 0],
          }
          const raw = String(a0 ?? '')
          const key = raw.toLowerCase()
          // 第三个参数（命名方向时）是这一眼的停留时长；连写多个「看」按顺序排队
          const schedule = (x, y, hold, label) => {
            const delay = lookCursor
            lookCursor += hold
            const fire = () => {
              state.agentLookUntil = performance.now() + hold + 200
              state.gaze?.setTarget(x, y)
            }
            if (delay > 0) setTimeout(fire, delay)
            else fire()
            push(it.verb, true, delay > 0 ? `${label} @${delay}ms` : label)
          }
          if (raw === '鼠标' || raw === '桌面' || key === 'cursor') {
            state.agentLookUntil = 0   // 交还桌面跟随
            lookCursor = 0
            push(it.verb, true, '鼠标')
          } else if (MAP[raw] || MAP[key]) {
            const v = MAP[raw] || MAP[key]
            schedule(v[0], v[1], clampNum(a1, 150, 8000, 650), raw)
          } else if (Number.isFinite(Number(a0)) && Number.isFinite(Number(a1))) {
            schedule(clampNum(a0, -1, 1, 0), clampNum(a1, -1, 1, 0), 650, `${a0},${a1}`)
          } else {
            push(it.verb, false, null, `看不懂「看」的目标：${raw}`)
          }
          break
        }
        case '换裙': {
          const long = /长/.test(String(a0 ?? '')) || String(a0).toLowerCase() === 'long'
          setSkirtLong(long)
          push(it.verb, true, long ? '长裙' : '短裙')
          break
        }
        case '尾巴': {
          const on = !OFF.test(String(a0 ?? '开'))
          state.layers?.removeExpression?.('尾巴开关')
          if (!on) {
            const def = (state.caps?.expressions || []).find((e) => e.name === '尾巴开关')
            if (def) state.layers?.addExpression('尾巴开关', def.params, { source: 'bus', fade: 0.25 })
          }
          syncTailRestore()
          state.recomputePass?.()
          push(it.verb, true, on ? '尾巴露出来' : '尾巴藏起来')
          break
        }
        case '转身': {
          skirtSway(clampNum(a0, 1, 30, 16))
          push(it.verb, true, `幅度 ${clampNum(a0, 1, 30, 16)}`)
          break
        }
        case '说': {
          const line = String(a0 ?? '')
          if (!line) { push(it.verb, false, null, '「说」后面没写台词'); break }
          state.bubble?.show(line, { state: 'idle', owner: 'agent' })
          push(it.verb, true, line)
          break
        }
        case '停': {
          const scope = String(a0 || '全部')
          if (scope === '表情' || scope === '全部') state.layers?.removeSource('bus')
          if (scope === '姿势' || scope === '全部') { state.poses?.release(); state.layers?.removeSource('rig') }
          if (scope === '全部') { state.bubble?.hide(); state.agentLookUntil = 0 }
          push(it.verb, true, scope)
          break
        }
        default:
          push(it.verb, false, null, `没实现的指令：${it.verb}`)
      }
    } catch (e) {
      push(it.verb, false, null, String(e && e.message || e))
    }
  }
  return out
}

/**
 * 「一段带指令的文本」入口：先解析 → 执行 → 只把台词念出来。
 * DSH 桥接的 say、手动测试、以后的 TTS 都走这一条路，保证只有一种协议。
 */
/**
 * 说话/动作/字幕的时间轴（2026-11 定稿）：
 *
 *   T1 = 这句话念多久（口型按它走）
 *   T2 = 这个动作还要播多久（含连拍队列）
 *   T  = max(T1, T2, 900)
 *
 * 气泡/字幕维持到 T —— 动作比话长时，字幕陪着动作演完；
 * 说完就没人说话时，也不会为了等嘴把气泡挂太久。
 */
function finalHoldMs(t1 = 0, t2 = 0) {
  return Math.max(900, Number(t1) || 0, Number(t2) || 0)
}

/** 表情默认存活时长：没给 ms 又没动作可依附时的兜底 */
const DEFAULT_EXPR_MS = 6000

/**
 * 播放结束「回归默认」：动作/台词都结束了，把这一轮挂上去的东西收掉。
 * - agent 加的表情（source:'bus'）—— 脸红不会挂到下一轮；
 * - 嘴部情绪（setMood）；
 * 还有动作在播时不清，交给动作自己的 onFinish（手位/手臂链由它和 11s 兜底收回）。
 */
let settleToken = 0
function settleAfter(ms = 0) {
  const token = ++settleToken
  setTimeout(() => {
    if (token !== settleToken) return
    if (state.idle?.state?.().current) return
    state.layers?.removeSource('bus')
    state.mouth?.clearMood?.()
  }, Math.max(200, Number(ms) || 0) + 150)
}

function speakAgent(input, opts = {}) {
  const parsed = parseIntents(input)
  const results = runIntents(parsed.intents)
  const errors = [
    ...parsed.errors,
    ...results.filter((r) => !r.ok).map((r) => ({ raw: r.verb, error: r.error })),
  ]
  const spoken = parsed.text
  if (spoken) state.history?.push({ kind: 'say', text: spoken, source: 'agent' })
  const t2 = state.idle?.remaining?.() || 0
  let hold = finalHoldMs(0, t2)
  if ((spoken || opts.image) && state.bubble) {
    // T1：口型时间轴（嘴按它走）；T2：这一轮点名的动作还要播多久
    const t1 = spoken ? (state.mouth?.speakText?.(spoken, {}) || 0) : 0
    state.bubble.show(spoken, { state: opts.state || 'idle', image: opts.image || '', owner: 'agent' })
    state.agentLink?.cancelHide?.()
    // 字幕维持到 T = max(T1, T2)
    hold = spoken ? finalHoldMs(t1, t2) : Math.max(1800, t2)
    setTimeout(() => { if (state.bubble?.text === spoken) state.bubble.hide() }, hold)
    // 显式台词占住气泡：这期间回合结束的「会话反馈」等后台动作不许顶掉
    state.busOwnUntil = Math.max(state.busOwnUntil || 0, performance.now() + hold + 400)
  }
  // 这一轮挂上去、又没写时长的表情：跟着最终时长一起退（脸红不会留到下一轮）。
  // 注意：没有台词时（纯 【表情|…】）也要走这里 —— 以前放在气泡分支里，纯表情就没人来收。
  {
    const mine = state.agentExprs || []
    state.agentExprs = []
    for (const e of mine) {
      setTimeout(() => { if (state.layers?.hasExpression?.(e.name)) state.layers.removeExpression(e.name) }, hold)
    }
  }
  settleAfter(Math.max(hold, t2))
  if (errors.length) {
    // 回执：agent 下一轮才知道自己写错了哪个词
    emitFeedback({ type: 'intent-error', detail: JSON.stringify(errors).slice(0, 500), at: null }, state.settings?.token)
  }
  state.busSnap?.()
  return { ok: !errors.length, text: spoken, results, errors, hold }
}

/** 下行动作：kind 见 docs/PROTOCOL.md。改这里 = 扩协议，记得同步文档。 */
function applyAction(msg) {
  const a = msg.action || {}
  const action = String(a.action || a.kind || '')
  const fade = Number(msg.fade ?? a.fade ?? 0.3)
  const agent = state.settings?.token
  // 后台动作（回合结束时桥接的「会话反馈」）不抢显式台词：
  // 否则我们刚说的话会被预设回复顶掉，气泡里根本看不清。
  if (String(msg.priority || '') === 'BACKGROUND' && performance.now() < (state.busOwnUntil || 0)) {
    state.busSnap?.()
    return
  }
  // agent 显式动作期间：待机小表情/随机动作让位，别在强情绪上插一张不相干的脸
  if (['say', 'intent', 'gesture', 'pose', 'expression'].includes(action)) {
    state.idleFaces?.pause?.(Math.max(5000, Number(a.ms) || 0))
    state.idle?.pause?.(2600)
  }
  switch (action) {
    case 'say': {
      const text = String(a.text ?? '')
      if ((!text && !a.image) || !state.bubble) break
      const image = a.image ? `/api/meme/${encodeURIComponent(String(a.image))}?token=${encodeURIComponent(state.settings.token)}` : ''
      const ms = Number(a.ms ?? 0)
      // 一段话里可以夹【动作|参数】块：块先执行，剩下的才是台词
      const r = speakAgent(text, { state: a.state || 'idle', image })
      // 显式指令优先于「工作状态」气泡：否则 DSH 状态轮询两秒后就把这句话盖掉
      state.busOwnUntil = performance.now() + Math.max(ms, r.hold || 1200) + 400
      if (ms > 0) setTimeout(() => { if (state.bubble?.text === r.text) state.bubble.hide() }, ms)
      break
    }
    case 'expression': {
      const name = a.name ? String(a.name) : ''
      state.layers?.removeSource('bus')
      if (!name) break
      const def = (state.caps.expressions || []).find((e) => e.name === name)
      if (!def) { console.warn('[bus] 没有这个表情:', name); break }
      state.layers?.addExpression(name, def.params, { source: 'bus', fade })
      state.history?.push({ kind: 'expr', name, on: true, source: 'agent' })
      // 表情必须有期限：有动作在播就跟着动作退；否则用默认寿命（避免脸红挂一整天）
      const t2 = state.idle?.remaining?.() || 0
      const keep = Number(a.ms) > 0 ? Number(a.ms) : (t2 > 0 ? t2 : (Number(state.exprTtlMs) || DEFAULT_EXPR_MS))
      setTimeout(() => { if (state.layers?.hasExpression?.(name)) state.layers.removeExpression(name) }, keep)
      settleAfter(keep)
      break
    }
    // 意图协议：整段文字（可夹【动作|参数】块），块执行、剩下的当台词
    case 'intent': {
      const r = speakAgent(String(a.text ?? ''), { state: a.state || 'idle', image: a.image ? `/api/meme/${encodeURIComponent(String(a.image))}?token=${encodeURIComponent(state.settings.token)}` : '' })
      state.busOwnUntil = Math.max(state.busOwnUntil || 0, performance.now() + Math.max(Number(a.ms) || 0, r.hold || 1200) + 400)
      if (Number(a.ms) > 0) setTimeout(() => { if (state.bubble?.text === r.text) state.bubble.hide() }, Number(a.ms))
      break
    }
    // 手势：和 【手势|…】 完全同一条执行路径；同时占住气泡一段时间，
    // 免得回合结束的状态联动把它盖掉
    case 'gesture': {
      state.busOwnUntil = performance.now() + Math.max(Number(a.ms) || 0, 6000)
      const name = String(a.name || '')
      if (!name) break
      const r = runIntents([{ verb: '手势', args: [name] }])
      if (!r[0]?.ok) console.warn('[bus] 手势失败:', r[0]?.error)
      break
    }
    // 成套动作：和 【动作|…】 同一条执行路径（走 idle 播放器，带手位/表情/台词）
    case 'act': {
      state.busOwnUntil = performance.now() + Math.max(Number(a.ms) || 0, 6000)
      const name = String(a.name || '')
      if (!name) break
      state.idleFaces?.pause?.(Math.max(5000, Number(a.ms) || 0))
      // manual：让位窗口里也要推进 —— 否则动作只进池子不播，表现就是「点了没反应」
      const played = state.idle?.trigger?.(name, { manual: true })
      if (!played) console.warn('[bus] 没有这个动作:', name)
      // 动作比话长时，字幕要陪着演完；结束后统一回归默认状态
      settleAfter(state.idle?.remaining?.() || 0)
      break
    }
    case 'pose': {
      if (!a.name) { state.poses?.release(Number(fade) * 1000 || 240); break }
      state.poses?.set(String(a.name), Number(a.ms) || 320)
      if (String(a.name) !== '默认手') armPoseAutoRelease()
      break
    }
    case 'look': {
      // 临时接管视线：hold 结束前不再跟鼠标（否则下一帧就被桌面坐标盖掉）
      state.agentLookUntil = performance.now() + (Number(a.ms) || BUS_HOLD_MS)
      state.gaze?.setTarget(Number(a.x ?? 0), Number(a.y ?? 0))
      break
    }
    case 'idle': {
      const mode = String(a.mode || (a.name ? 'play' : 'pause'))
      if (mode === 'play') state.idle?.trigger(a.name ? String(a.name) : undefined, { manual: true })
      else if (mode === 'pause') state.idle?.pause(Number(a.ms) || 5000)
      else if (mode === 'resume') state.idle?.resume?.()
      // on/off：模型自己开关「待机动作」总闸 —— 关掉后就只剩呼吸/眨眼，不再自己乱动
      else if (mode === 'on' || mode === 'off') {
        const on = mode === 'on'
        state.idle?.setEnabled?.(on)
        // 持久化：否则下一次设置广播会按旧值把开关改回去
        try { shell.set({ idle: on }) } catch {}
      }
      break
    }
    case 'state': {
      // 显式台词还没到期：状态联动别盖掉它（回合结束时桥接先说总结，状态更新往往晚到）
      if (performance.now() < (state.busOwnUntil || 0)) break
      // 复用 DSH 联动那条路：气泡文案 / 表情 / 小动作的映射都在 agent-link.js
      state.agentLink?.apply({ state: a.state ?? null, at: Date.now(), task: a.task ?? null })
      break
    }
    case 'stop': {
      const scope = String(a.scope || 'all')
      if (scope === 'all' || scope === 'expression') state.layers?.removeSource('bus')
      if (scope === 'all') { state.poses?.release(); state.bubble?.hide() }
      break
    }
    default: break
  }
  // 动作执行完立刻刷新快照 + 打一条回执，agent 侧不用等下一次心跳
  state.busSnap?.()
  emitFeedback({ type: 'action-done', gesture: action, detail: msg.id || null, at: null }, agent)
}

function bootBus() {
  const token = state.settings?.token
  const port = state.settings?.port
  if (!token || !port) {
    console.warn('[bus] 缺少 token/port：外部控制不可用')
    return
  }
  const snap = () => {
    if (!state.bubble) return
    postJSON('/api/snapshot', {
      model: state.caps?.model?.name || null,
      agent: state.agentLink?.state() ?? null,
      bubble: state.bubble.state(),
      idle: state.idle?.state() ?? null,
      pose: state.poses?.state() ?? null,
      // 当前挂着的表情层（source=bus 的是外部指令，agent 的是 DSH 状态）
      exprs: (state.layers?.inspect?.()?.layers || []).map((l) => `${l.source}:${l.name}`),
      look: state.agentLookUntil > performance.now() ? 'agent' : 'cursor',
      // 帧率上限（0 = 不限制）与实测帧率：排查「为什么在耗电 / 为什么卡」时先看这两个数
      fps: { cap: state.fps ?? null, actual: state.fpsActual ?? null },
      // 最近做了什么：agent 接话/接动作时能知道「我刚演过什么、用户刚摸了哪」
      history: state.history?.summary?.() ?? null,
      // 当前情绪权重（害羞/生气/开心/好奇/困倦）：给 agent 一个「她现在心情如何」的粗读
      mood: state.mood?.state?.() ?? null,
    }, token)
  }
  state.seenActions = state.seenActions || new Set()
  const handle = (msg) => {
    if (!msg || msg.type !== 'action') return
    if (msg.id) {
      if (state.seenActions.has(msg.id)) return
      state.seenActions.add(msg.id)
      if (state.seenActions.size > 120) state.seenActions.delete(state.seenActions.values().next().value)
    }
    try { applyAction(msg) } catch (err) { console.warn('[bus] 动作失败', err) }
  }
  try {
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
    es.onmessage = (e) => {
      let msg = null
      try { msg = JSON.parse(e.data) } catch { return }
      // hello 带回连接的最近动作（页面刚重载也能补齐）
      if (msg.type === 'hello') { for (const a of msg.actions || []) handle({ ...a, type: 'action' }); return }
      handle(msg)
    }
    es.onerror = () => { /* 服务端 retry:2000，EventSource 自己重连 */ }
    state.bus = es
  } catch (e) { console.warn('[bus] 连接失败', e) }
  state.busSnap = snap
  snap()
  state.busTimer = setInterval(snap, 4000)
}

async function main() {
  try {
    state.settings = await shell.get()
    state.caps = await fetch('/api/capabilities').then((r) => r.json())
    if (state.settings.profileMode === 'generic') {
      const { startGeneric } = await import('./generic.js')
      const genericStage = await startGeneric(shell, state.settings, state.caps)
      installBodyPort(shell, createConversationAdapter(genericStage, { mode: 'generic' }))
      return
    }
    // 先吃「改动补丁」：姿势/台词/反应/热区都能被覆盖，用户拿原模型也能复现我们的改动
    await applyStagePatch()
    await bootStage()
    installBodyPort(shell, createConversationAdapter(state.stage, { mode: 'deepseek' }))
    applyFps()
    // 实测帧率：每帧 +1，每秒结算一次（状态快照里能看到 cap 与 actual）
    let frames = 0
    state.stage.ticker.add(() => { frames += 1 })
    setInterval(() => { state.fpsActual = frames; frames = 0 }, 1000)
    bootRegions()
    // 启动时把设置整体应用一遍：体型 / 视线 / 待机 / 描边都在这里落地。
    // 以前只靠主进程「窗口尺寸变了才广播」顺带带一次，无头环境或广播晚到就会
    // 「设置里存着 Q 版、重启却变回标准体型」。
    applySettings(state.settings)
    // 窗口尺寸跟角色绑定：模型尺寸拿到了，立刻把窗口收成刚好包住角色的样子
    applyFit(true)
    // 对话气泡：贴窗口右上角（选左侧就贴左上角），窗口本身刚好包住角色，所以等于贴在头斜上方
    state.bubble = createBubble({
      el: $('#bubble'),
      side: 'right', // 位置固定贴右上角（自定义左右已移除）
      corner: true,
      // 冒泡时动嘴：按字数估时长（约 145ms/字 + 起止），念完自动收
      onSpeak: (text) => {
        // null = 气泡收起：闭嘴，回到呼吸的常态
        if (text == null) { state.mouth?.stop?.(); return }
        const n = Array.from(String(text)).length
        const ms = Math.max(600, Math.min(4200, 160 + n * 145))
        state.mouth?.talk?.(ms)
      },
    })
    setInterval(() => { if (state.bubble?.visible) state.bubble.reposition() }, 200)
    // DSH 联动：状态 → 气泡台词 / 表情 / 小动作（状态文件由主进程轮询后推过来）
    state.agentLink = createAgentLink({
      bubble: state.bubble,
      layers: state.layers,
      expressions: state.caps.expressions || [],
      poses: state.poses,
      life: state.life,
      mouth: state.mouth,
    })
    shell.onAgentStatus?.((snap) => {
      // 外部指令刚说过的台词有优先权（时长见 applyAction 的 say）
      if (performance.now() < (state.busOwnUntil || 0)) return
      state.agentLink?.apply(snap)
    })
    bindSettings()
    bindTools()
    bindZoomWheel()
    bindWindowDrag()
    bindToolsDismiss()
    bindFrame()
    bindPassThrough()
    state.bubble.setScale(bubbleScale())
    applyBorder(!!state.settings.border)
    bootPerfOverlay()
    bootBus()
    document.title = `stage · ${state.caps.model.name}`
    // 启动阶段的 applyFit(true) 已经算过居中；这之后体型/换装变化才需要重新居中
    state.bootReady = true
  } catch (e) {
    console.error(e)
    toast(`启动失败：${e.message}`, 6000)
  }
}

/**
 * 改动补丁（stage-patch.json）。
 *
 * 定位：我们**不发布改过的模型**，只发布「我们这层加了什么」——
 * 姿势、台词、分区反应、热区几何。下载者拿自己的原模型 + 这个补丁，
 * 行为就和我们改完一样，不需要二次改膜。
 *
 * 注意：moc3 里的绘制顺序、手臂活动范围这类改不了的东西不在补丁范围内，
 * 那必须重新出模型（补丁里只记录 model 名字，做兼容提示）。
 */
async function applyStagePatch() {
  let p = null
  try { p = await shell.patchLoad?.() } catch { p = null }
  if (!p || typeof p !== 'object') return null
  state.patch = p
  if (p.poses && typeof p.poses === 'object') Object.assign(POSES, p.poses)
  if (p.phrases && typeof p.phrases === 'object') Object.assign(PHRASES, p.phrases)
  // 反应补丁要按「部位 + 手势」合并：旧补丁可能只记了部分手势（比如尾巴只记了 tap），
  // 直接 Object.assign 会把整条覆盖掉 → 后来新增的抚摸反应静默失效（摸尾巴没表情）。
  if (p.reactions && typeof p.reactions === 'object') {
    for (const [name, byKind] of Object.entries(p.reactions)) {
      if (!byKind || typeof byKind !== 'object') continue
      DEFAULT_REACTIONS[name] = { ...(DEFAULT_REACTIONS[name] || {}), ...byKind }
    }
  }
  if (p.model && state.caps?.model?.name && p.model !== state.caps.model.name) {
    toast(`补丁是为「${p.model}」做的，当前模型是「${state.caps.model.name}」`, 5000)
  }
  return p
}

/** 导出当前改动：姿势 + 台词 + 反应 + 热区（不含模型本体） */
async function exportStagePatch() {
  if (!state.caps) return null
  const data = {
    version: 1,
    model: state.caps.model.name,
    exportedAt: new Date().toISOString(),
    poses: POSES,
    phrases: PHRASES,
    reactions: DEFAULT_REACTIONS,
    regions: state.store ? { schemaVersion: 2, model: state.caps.model.name, regions: state.store.all } : null,
  }
  const r = await shell.patchSave?.(data)
  toast(r?.ok ? '改动补丁已保存（stage-patch.json）' : '补丁保存失败')
  return r
}

async function loadPhysicsFlow() {
  const empty = { inputs: new Set(), outputs: new Set() }
  try {
    const modelUrl = new URL(state.caps.model.url, location.href).href
    const model = await fetch(modelUrl).then((r) => r.json())
    const rel = model?.FileReferences?.Physics
    if (!rel) return empty
    const phys = await fetch(new URL(rel, modelUrl).href).then((r) => r.json())
    const inputs = new Set()
    const outputs = new Set()
    for (const s of phys.PhysicsSettings || []) {
      for (const i of s.Input || []) if (i?.Source?.Id) inputs.add(i.Source.Id)
      for (const o of s.Output || []) if (o?.Destination?.Id) outputs.add(o.Destination.Id)
    }
    return { inputs, outputs }
  } catch { return empty }
}

const CTX_RELOAD_KEY = 'stage/ctxReloads'

// 窗口可见性 → 是否出帧。模块级声明：bootStage 里要用来落地「启动即隐藏」的情况。
// stageApplied 单独记「已经作用到帧循环上的状态」—— 首帧循环还没建好时调用不能算数，
// 否则之后同样的值会被当成「没变化」而不再下发（隐藏状态下启动就再也停不下来）。
let stageActive = true
let stageApplied = null

/**
 * WebGL 上下文丢失兜底。
 * 合盖唤醒、显卡驱动重置、显存吃紧都会让上下文丢失，而 Pixi 不会自愈 ——
 * 不处理的表现就是「角色变成一块白板/透明，只能重启应用」。
 * 就地重载整页重建渲染栈，带次数护栏（20 秒内没再丢就清零），避免反复重载。
 */
function bindContextRecovery(stage) {
  const cv = stage?.canvas
  if (!cv) return
  cv.addEventListener('webglcontextlost', (e) => {
    // 必须 preventDefault：否则浏览器不会再尝试恢复上下文，我们也没机会重建
    e.preventDefault()
    const n = Number(sessionStorage.getItem(CTX_RELOAD_KEY) || 0) + 1
    try { sessionStorage.setItem(CTX_RELOAD_KEY, String(n)) } catch {}
    console.warn('[stage] WebGL 上下文丢失，第', n, '次，重建渲染层')
    state.faults?.push?.('webgl:context-lost', { reloads: n })
    if (n > 2) { toast('渲染上下文反复丢失，请重启应用', 4000); return }
    setTimeout(() => location.reload(), 500)
  })
  // 撑过 20 秒没再丢 → 清零，下次还能自愈
  setTimeout(() => { try { sessionStorage.setItem(CTX_RELOAD_KEY, '0') } catch {} }, 20000)
}

/**
 * 扩展接口入口：把舞台与嘴交给注册表，再按 ?ext= 加载用户扩展（见 docs/EXTENDING.md）。
 * 必须在 createMouth 之后调用（provider 要挂到嘴上），失败也不该拖垮舞台。
 */
function initExtensions({ stage }) {
  bindExtensionContext({ stage, mouth: state.mouth, log: (...a) => console.log('[ext]', ...a) })
  window.Live2DStage = {
    apiVersion: 1,
    registerLipSync, registerActionPack,
    useLipSync, clearLipSync, listLipSyncs, listActionPacks,
    registerVariants, listVariants,
    loadUserExtensions,
    exportDiagnostic: () => shell.exportDiagnostic?.(),
    faults: () => state.faults?.list?.() ?? [],
    mouth: state.mouth,
    stage,
  }
  const list = new URLSearchParams(location.search).get('ext')
  if (!list) return
  for (const url of list.split(',').map((s) => s.trim()).filter(Boolean)) {
    import(url).catch((e) => { console.warn('[ext] 加载失败', url, e); toast('扩展加载失败：' + url, 3000) })
  }
}

async function bootStage() {
  const stage = await createStage({
    container: $('#stage'),
    modelUrl: state.caps.model.url,
    // ?noaa=1 只用于性能对照：关掉 MSAA，看 4x 多重采样吃掉了多少帧
    antialias: !/[?&]noaa=1/.test(location.search),
  })
  state.stage = stage
  bindContextRecovery(stage)

  // 出帧节奏：网格锚定，固定 60 帧（子窗口开着时降到 30）。
  // 不再是「不限帧 + 挑一个 maxFPS」：那两个都实测过，会让帧落在显示刷新的非整数倍上，
  // 屏幕把前一帧多停一个刷新、后一帧少停一个 —— 就是「概率性抖动」。详见 docs/PERF-RESEARCH.md。
  if (stage.frameLoop) await stage.frameLoop.start({ fps: state.throttled ? 30 : (state.settings?.targetFps === 60 ? 60 : 30) })
  else if (stage.ticker) stage.ticker.maxFPS = 60   // pixi7 实验引擎没有网格循环，退回限帧兜底
  // 把真实可见性落到刚建好的帧循环上（启动时就是隐藏状态 → 一秒都不出帧）
  setStageActive(!document.hidden)

  // 故障记录：全局报错 / 扩展加载失败 / 长帧 → 上报主进程落盘（见 docs/故障排查.md）
  state.faults = createFaultLog({
    send: (kind, detail) => { try { shell.fault?.(kind, detail) } catch {} },
    context: () => ({ frameCostMs: stage.frameLoop?.info().costMs, audioState: window.__companionBody?.('snapshot')?.audioState }),
    info: { engine: __ENGINE, nativeCore: !shell.contextIsolated },
  })
  if (stage.frameLoop) stage.frameLoop.onFrame(state.faults.frameGap)
  try { shell.rendererInfo?.({ engine: __ENGINE, nativeCore: !shell.contextIsolated, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent }) } catch {}

  // 尺寸变化与渲染同拍：resize 事件只记「待办」，真正的画布重建放进下一帧出帧钩子里，
  // 一帧最多重排一次（以前每个 resize 事件都会立刻重建画布，拖动窗口边缘时一帧里能来好几次）。
  window.addEventListener('resize', () => {
    state.pendingSize = { w: window.innerWidth, h: window.innerHeight }
  })
  const applyPendingSize = () => {
    const p = state.pendingSize
    if (!p) return
    state.pendingSize = null
    stage.resize(p.w, p.h)
  }
  if (stage.frameLoop) stage.frameLoop.onFrame(applyPendingSize)
  else window.addEventListener('resize', applyPendingSize)

  state.physics = await loadPhysicsFlow()
  state.layers = createLayerStack({
    param: stage.param,
    part: stage.part,
    isPhysicsInput: (id) => state.physics.inputs.has(id) && !state.physics.outputs.has(id),
  })
  // （姿势与物理输入的写入点在下面统一注册：必须在物理之前）

  state.reactions = createReactions({
    layers: state.layers,
    expressionDefs: state.caps.expressions,
    onEvent: (e) => { if (e.type === 'warn') console.warn('[reaction]', e.text) },
    onClear: () => state.agentLink?.reapply?.(),
  })
  // 差分抽签：mood 传函数，每次抽签现读当前情绪（半衰期内会一直在变）
  state.variants = createVariantPicker({ mood: () => state.mood?.state?.() || {} })

  // 姿态总线：头/身角度的唯一写入者（物理前后各写一次，各层只累加）
  state.poseBus = createPoseBus({ param: stage.param })

  state.gaze = createGaze({
    param: stage.param,
    bus: state.poseBus,
    // 身体角度交给 posture 层（脊柱链），视线只管眼珠与头
    options: {
      enabled: state.settings.gaze !== false,
      strength: Number(state.settings.strength ?? 1),
      headGain: Number(state.settings.headGain ?? 1.25),
      body: 0, bodyRoll: 0,
    },
  })

  // 姿态链：头 → 胸 → 腰 逐级跟随（弹簧 + 过冲），并且喂给物理权重最高的输入
  state.posture = createPosture({
    param: stage.param,
    gaze: state.gaze,
    bus: state.poseBus,
    options: { strength: Number(state.settings.strength ?? 1) },
  })

  // 抚摸晃动：蹭头时额外叠一层摆动（gaze 先定方向，这层再叠幅度）
  state.petSway = createPetSway({
    param: stage.param,
    bus: state.poseBus,
    options: { gain: Number(state.settings.petGain ?? 1.6) },
  })

  // 伪面捕驱动：把「我们的姿态」翻译成模型的**面捕捉取通道**
  // （AngleX/Y/Z、PositionX/Y、ParamBreath、JawOpen…），物理链才会整条活起来
  state.capture = createCapture({ param: stage.param, bus: state.poseBus })

  // 活气层：耳朵扑棱 / 头发惯性 / 耳环摆动（读回物理值再叠加，写在物理之后）
  // 要早于捏脸创建 —— 捏脸时借它做「耳朵快速扑棱」
  state.life = createLife({ param: stage.param })

  // 捏脸：按住「脸」热区拖动 → 鼓脸/单边鼓/抖脸盘 + 身体前倾放大
  state.facePinch = createFacePinch({
    param: stage.param,
    bus: state.poseBus,
    life: state.life,
    options: {
      // 用户手动开了「前倾」时，捏脸就不再抢 LeanInput
      leanBlocked: () => !!state.layers?.hasExpression('前倾'),
    },
  })

  // 痒痒的：摸脚 / 摸腰时的躲痒小动作（胸腔骨盆快抖 + 两侧小臂摆 + 两只耳朵扑腾）
  state.tickle = createTickle({
    bus: state.poseBus,
    life: state.life,
    onHold: (id, v) => { if (v == null) state.layers?.release(id); else state.layers?.hold(id, v) },
  })
  // 嘴：呼吸微动 + 说话音节（模型 LipSync 组是空的，这是唯一驱动源）
  state.mouth = createMouth({ param: stage.param })
  initExtensions({ stage })
  // 随机小表情：笑 / 吐舌头 / 吐舌头+单眼笑，待机时自己冒出来。
  // 有人会觉得「脸怎么自己变了」——设置里给了开关（randomFaces），关掉就只动身体不动脸。
  state.idleFaces = createIdleFaces({ param: stage.param, options: { auto: state.settings?.randomFaces !== false } })
  // 终点姿势：举手 / 竖手指 / 狗尾草（数值取自模型自带的 motion3 末帧），过渡自己补
  state.poses = createPoses({ layers: state.layers })

  // 待机动作：桌面没人互动时自己在动（常驻微摆 + 随机成套动作，部分带小台词）
  let idleLineTimer = 0
  let armsActive = false
  /** 这一条动作是我们替它切到「举手族」的吗（结束时才需要还原） */
  let armsFamilyOwned = false
  state.idle = createIdleMotions({
    bus: state.poseBus,
    param: stage.param,
    life: state.life,
    idleFaces: state.idleFaces,
    options: {
      enabled: state.settings.idle !== false,
      speed: Number(state.settings.idleSpeed ?? 1),
      // 动作播放速度：1 = 预设速度上限（模型自带动作的节奏）。只作用于动作轨道，
      // 手/裙子的贴图切换（poses.set / 裙子切换）保持固定时长。
      playback: Number(state.settings.actionSpeed ?? 0.8),
      // 情绪加权：害羞/生气/开心… 高的那类动作更容易被随机挑到
      bias: (name) => state.mood?.weightOf?.(name) ?? 1,
    },
    // 成套动作的「道具」：姿势 / 表情 / 嘴型 / 风，开始时挂上、结束时撤掉
    onStart: (name, r, opts = {}) => {
      state.history?.push({ kind: 'act', name, source: opts.manual ? 'manual' : 'idle', ms: r.ms })
      if (r.pose) state.poses?.set(r.pose, 360)
      // 带手臂的成套动作，arms 写的是「相对举手族基线」的偏移。
      // 当前若还是默认手（Movement2=0），整条手链参数都会空转 —— 动作看着就是没播出来。
      else if (r.arms) {
        const active = String(state.poses?.state?.().active || '')
        if (active === '默认手' || (!active.includes('举手') && !active.includes('抚胸'))) {
          state.poses?.set('举手', 360)
          armsFamilyOwned = true
        }
      }
      for (const n of r.exprs || []) {
        const def = (state.caps.expressions || []).find((e) => e.name === n)
        if (def) state.layers?.addExpression(n, def.params, { source: 'idle-exp', fade: 0.28 })
      }
      if (r.mouth) {
        // 先按完整预设挂上（O 嘴这类动作本身就要这个口型）；
        // 真开口说话时（onLine）再切成「只留表情形状」，开合交给口型时间轴。
        state.idleMouthSpec = r.mouth
        state.mouth?.setMood(mouthOf(r.mouth), r.ms)
      }
      if (r.gust) state.life?.gust?.(r.gust, r.ms)
    },
    onFinish: (name, r) => {
      state.history?.push({ kind: 'act-end', name })
      state.idleMouthSpec = null
      if (r.pose || armsFamilyOwned) { state.poses?.release(420); armsFamilyOwned = false }
      if (r.exprs?.length) state.layers?.removeSource('idle-exp')
      if (r.mouth) state.mouth?.clearMood()
    },
    // 物理输出参数（左臂 Z 等）用 hold 写绝对值；null = 释放
    onHold: (id, v) => {
      if (v == null) state.layers?.release(id)
      else state.layers?.hold(id, v)
    },
    // 举手族的手臂链：动作给的是「目标落点」，这里换算成相对族基线的偏移写进 poses
    armBase: () => state.poses?.armBase?.() ?? {},
    onArms: (off) => {
      if (off) {
        armsActive = true
        state.poses?.tune?.(off, 0)
        // 联动补偿：手抬起来肩要跟着提，否则像手脱臼（每帧求值，纯函数）
        const comp = armLinkageFromTune(off)
        for (const [id, v] of Object.entries(comp)) if (v) state.poseBus?.add?.(id, v)
      } else if (armsActive) {
        armsActive = false
        state.poses?.clearTune?.(300)
      }
    },
    // 小台词用气泡；正在显示 DSH 状态（thinking/working/…）时不抢话
    onLine: (text, ms = 4200) => {
      const b = state.bubble
      if (!b) return
      if (state.settings.bubble === false) return
      const st = b.state?.()
      if (st?.visible && st.state && st.state !== 'idle') return
      state.history?.push({ kind: 'say', text, source: 'idle' })
      state.mouth?.speakText?.(text, {})
      // 说话了：开合归口型时间轴，嘴型只保留微笑/撇嘴这类形状
      if (state.idleMouthSpec) {
        const shape = mouthForAction(state.idleMouthSpec, { speaking: true })
        if (Object.keys(shape).length) state.mouth?.setMood(shape, 4200)
      }
      b.show(text, { state: 'idle' })
      emitFeedback({ type: 'idle-line', detail: text }, state.settings?.token)
      clearTimeout(idleLineTimer)
      idleLineTimer = setTimeout(() => { if (b.state?.().state === 'idle') b.hide() }, ms)
    },
  })

  let lastT = performance.now()
  let frameDt = 1000 / 60
  const motionState = { x: null, y: null, vx: 0, vy: 0, ax: 0, ay: 0 }
  // 拖拽物理的身体位移（弹簧状态：rx/ry 当前偏移，vrx/vry 速度）
  const dragShape = { rx: 0, ry: 0, vrx: 0, vry: 0 }
  const tickDt = () => {
    const now = performance.now()
    frameDt = Math.min(120, Math.max(1, now - lastT))
    lastT = now
  }
  // 拖动冻结解除时把时间基准归零：否则恢复那一帧会拿到「整段拖动时长」，
  // 物理/动作一次性跳一大步（上限 120ms，看起来就是甩一下）
  state.resetDt = () => { lastT = performance.now() }

  /**
   * 窗口/角色的位移加速度 → 惯性冲击。
   * 拖动窗口时（中键/右键按住角色搬窗），角色的头发、耳环、
   * 裙摆会「被甩」——这才是拖动时最出效果的那一下。窗口坐标变化由 screenX/Y 读到。
   */
  const updateMotion = (dtMs) => {
    // 用「角色在屏幕上的位置」做微分：窗口被搬 + 角色在窗口内被挪，两条路都能触发惯性。
    const x = window.screenX + (state.stage?.model?.position?.x || 0)
    const y = window.screenY + (state.stage?.model?.position?.y || 0)
    if (motionState.x == null) { motionState.x = x; motionState.y = y; return }
    // 中键/右键拖动同一套物理：抓取向量优先，窗口坐标差分兜底
    const dt = Math.max(0.008, dtMs / 1000)
    // 拖动中优先用「抓取向量」（pointermove 的实时位移速度）；窗口跟着鼠标走时，
    // 用窗口坐标做差分几乎恒为 0，物理自然要等到松手才动 —— 这就是之前「拖完才甩」的原因
    const dragV = state.windowDragging && state.dragVec && performance.now() - state.dragVec.t < 120 ? state.dragVec : null
    const vx = dragV ? dragV.vx : (x - motionState.x) / dt
    const vy = dragV ? dragV.vy : (y - motionState.y) / dt
    const ax = Math.max(-20000, Math.min(20000, (vx - motionState.vx) / dt))
    const ay = Math.max(-20000, Math.min(20000, (vy - motionState.vy) / dt))
    motionState.x = x
    motionState.y = y
    motionState.vx = vx
    motionState.vy = vy
    // 平滑一层：窗口坐标是整数，直接微分会有尖刺
    motionState.ax = motionState.ax * 0.6 + ax * 0.4
    motionState.ay = motionState.ay * 0.6 + ay * 0.4
    state.life?.motion(motionState.ax, motionState.ay)
    state.capture?.motion(motionState.vx, motionState.vy)
    // 拖拽物理演算：拖动速度 → 身体位移（弹簧跟随，松手有余震），
    // 喂给 physics3 的 `ParamBodyAngleRX`（既入又出）→ 模型自带的头发/衣服/耳朵物理整条甩起来。
    // 注意：RX 主要驱动的是**头发链**，给大了就是「头发乱飞、身体没动」——
    // 所以这里幅度收小（±6/±4），而且头发自己还有 life.js 的弹簧层，两层叠起来刚好。
    if (state.settings.dragPhysics !== false) {
      const targetX = Math.max(-6, Math.min(6, -motionState.vx * 0.013))
      const targetY = Math.max(-4, Math.min(4, -motionState.vy * 0.009))
      // 弹簧-阻尼：stiffness 越大跟得越紧，damping 越大越快停
      // 拖的时候跟得紧（高阻尼），松手后低阻尼自由回弹：余震约 0.5–0.7 秒才收住
      const stiff = 45
      const damp = state.windowDragging ? 22 : 5.5
      dragShape.vrx += ((targetX - dragShape.rx) * stiff - dragShape.vrx * damp) * dt
      dragShape.vry += ((targetY - dragShape.ry) * stiff - dragShape.vry * damp) * dt
      dragShape.rx += dragShape.vrx * dt
      dragShape.ry += dragShape.vry * dt
      state.poseBus?.add('ParamBodyAngleRX', dragShape.rx)
      state.poseBus?.add('ParamBodyAngleRY', dragShape.ry)
    }
  }

  // ① 物理之前：喂物理输入 + 摆姿势。
  // 物理的输入就是「头部角度 / 呼吸 / 前倾」（physics3 实测 19 处引用），
  // 而我们原来在物理**之后**才写这些角度 —— 等于让物理永远在算静止的模型，
  // 头发、耳朵、耳环的物理全部僵死，这就是「没有物理效果」的真正原因。
  stage.onBeforePhysics(() => {
    state.poseBus?.clear()   // 新的一帧：清掉上一帧的姿态累计
    tickDt()
    updateMotion(frameDt)
    // 情绪随时间衰减：互动停下后慢慢回到中性
    state.mood?.update?.(frameDt)
    // 动作在写头部/身体角度时，鼠标追踪要按**幅度**让位，而不是一有头部轨道就全掐：
    // 5° 的小动作（戴铁盆、撩头发）本来就能和视线叠加着看，
    // 一刀切成 0 的后果就是「放个表情，头就不跟鼠标了」。
    // 分档：≤4° 不让位，4~12° 线性过渡，≥12° 完全交给动作。
    const load = Number(state.idle?.headLoad?.() || 0)
    const targetK = load <= HEAD_YIELD_LO ? 1
      : load >= HEAD_YIELD_HI ? 0
        : (HEAD_YIELD_HI - load) / (HEAD_YIELD_HI - HEAD_YIELD_LO)
    const curK = Number(state.headYieldK ?? 1)
    // 平滑：动作起止时强度是渐变的，不会「啪」一下抬头/低头
    const nextK = Math.abs(targetK - curK) < 0.002 ? targetK : curK + (targetK - curK) * Math.min(1, frameDt * 9)
    state.yieldHead = nextK < 0.999
    if (Math.abs(nextK - (state.headYieldApplied ?? -1)) > 0.02) {
      state.headYieldK = nextK
      state.headYieldApplied = nextK
      const s = Number(state.settings?.strength ?? 1)
      state.gaze?.set({ strength: s * nextK })
      state.posture?.set({ strength: s * nextK })
    }
    // 姿势值要先钉进 layers，applyPhysics 才会把物理输入一起喂进去
    state.poses?.apply(frameDt)
    state.layers.applyPhysics()
    state.facePinch?.applyPhysics()
    perf.time('pre', () => {
      state.gaze?.apply(frameDt)
      state.petSway?.apply(frameDt)
      state.facePinch?.applyPosture(frameDt)
      // 脊柱链：胸/腰跟随（喂给物理权重最高的 ParamBodyAngleX/Z）
      state.posture?.apply(frameDt)
      // 待机动作：常驻微摆 + 随机成套动作（叠加在同一份姿态里）
      state.idle?.apply(frameDt)
      // 痒痒的：躲痒小动作（摸脚/摸腰时）
      state.tickle?.apply(frameDt)
      // 姿态摆好之后，翻译成面捕捉取通道（物理要吃的就是这些）
      state.capture?.apply(frameDt)
    })
    // 各层只累加了增量，这里统一写成参数，物理拿到的就是这份合成姿态
    state.poseBus?.flush()
  })

  // ② 物理之后：表情 / 嘴 / 活气 / 鼓脸。
  // 物理会把 ParamAngle* / ParamBodyAngle* 当输出重算，所以姿态要在这里再写一次 ——
  // 但写的是**同一份合成姿态**（总线里的累计值），不是某一层的旧值，谁也不会盖掉谁。
  stage.onBeforeUpdate(() => {
    perf.time('post', () => {
      state.layers.apply()
      state.mouth?.apply(frameDt)
      state.idleFaces?.apply(frameDt)
      state.life?.apply(frameDt)
      state.facePinch?.apply(frameDt)
      // 放在最后：表情层可能也写过这些角度，姿态合成值优先级最高
      state.poseBus?.flush()
    })
  })

  // ③ 再往后：甩尾。必须排在 poseBus.flush 之后 ——
  // HipAngleZ / ParamBodyAngleZ 是姿态总线也会写的参数，写在它前面会被整帧覆盖，
  // 表现就是「摸尾巴时身体和尾巴一动不动」。这里只在甩尾窗口内独占这几个参数。
  stage.onBeforeUpdate(() => {
    const tw = state.tailWag
    if (!tw) return
    const p = (performance.now() - tw.t0) / tw.ms
    if (p >= 1) { state.tailWag = null; return }
    // 钟形包络：起手快、收尾软，别一上来就猛甩
    const env = Math.min(1, p / 0.1) * Math.min(1, (1 - p) / 0.24)
    const s = Math.sin(p * Math.PI * 2 * 2.4) * env
    stage.param.set('HipAngleZ', s * 24)          // 甩胯（尾巴跟着这道摆）
    stage.param.set('ParamBodyAngleZ', -s * 13)   // 上半身反向，整体是「扭」
    stage.param.set('HipAngleX', Math.cos(p * Math.PI * 2 * 2.4) * env * 4)
  })

  // ---------- 标定探针（开发期用：单参数覆写 / 物理读回采样） ----------
  installProbes({ motionState })

  const viewport = createViewport({ model: stage.model, app: stage.app })
  state.viewport = viewport
  viewport.observe($('#stage'))
  const clampOff = (v) => Math.max(-1.5, Math.min(1.5, Number(v) || 0))
  viewport.set({
    zoom: Number(state.settings.zoom) || 1,
    offsetX: clampOff(state.settings.offsetX),
    offsetY: clampOff(state.settings.offsetY),
  })

  // 窗口坐标为「客户端像素」，窗口外的点会是负数/越界值，正是我们要的方向。
  // 参考半径按「半个屏幕」给，所以鼠标跑到窗口外、桌面任何角落都有明确方向感。
  const lookFromClient = (cx, cy) => {
    // agent 正在指定视线（look 动作）时不抢镜，hold 到期自动交还鼠标
    if (performance.now() < (state.agentLookUntil || 0)) return
    // 捏脸时保持正脸：视线不再跟着鼠标转，否则鼓脸会转到侧面看不见
    if (state.facePinch?.state?.()?.side) return
    const r = stage.canvas.getBoundingClientRect()
    const sw = stage.app.screen.width, sh = stage.app.screen.height
    const dpr = sw / Math.max(1, r.width)
    const sx = ((cx - r.left) / Math.max(1, r.width)) * sw
    const sy = ((cy - r.top) / Math.max(1, r.height)) * sh
    const halfW = Math.max(r.width / 2, (window.screen?.width || r.width) / 2) * dpr
    const halfH = Math.max(r.height / 2, (window.screen?.height || r.height) / 2) * dpr
    const m = stage.model
    state.gaze.setTargetFromScreen(sx, sy, m.position.x, m.position.y, halfW, halfH)
    window.__gazeLast = { cx: Math.round(cx), cy: Math.round(cy) }
  }

  window.addEventListener('pointermove', (e) => {
    lookFromClient(e.clientX, e.clientY)
    // 抚摸中的位移（客户端像素）→ 头摆
    const lastC = state.lastClient
    state.lastClient = { x: e.clientX, y: e.clientY }
    if (state.petArmed && lastC) {
      state.petSway?.move(e.clientX - lastC.x, e.clientY - lastC.y, window.innerWidth, window.innerHeight)
    }
  })
  // 桌面级跟随：主进程持续读全局光标位置，窗口外也能看过去
  shell.onCursor?.((p) => {
    window.__cursorLast = p // 诊断用：看主进程推来的到底是什么坐标
    if (!window.__noDesktopGaze) lookFromClient(p.x, p.y)
  })
}

/** 捏脸时的表情反馈：＞＜ + 脸红（独立 source，松手整组撤掉，不干扰分区反应） */const PINCH_EXPRS = ['＞＜', '脸红']
function pinchExpressions(on) {
  if (!state.layers) return
  if (!on) { state.layers.removeSource('pinch'); return }
  for (const n of PINCH_EXPRS) {
    const def = (state.caps.expressions || []).find((e) => e.name === n)
    if (def) state.layers.addExpression(n, def.params, { source: 'pinch' })
  }
}

/**
 * 摸胯时的神态：眼睛只睁一半 + 眯眼 + 眉毛「\ /」+ 瞳孔收紧。
 * （模型没有「瞳孔缩放」参数，只有 PupilX/PupilY 透视位移，所以缩瞳用眯眼 + 收缩上下眼睑近似）
 */
const CROTCH_FACE = [
  { Id: 'ParamEyeLOpen', Value: 0.52, Blend: 'Overwrite' },
  { Id: 'ParamEyeROpen', Value: 0.52, Blend: 'Overwrite' },
  { Id: 'LEyeSquint', Value: 0.35, Blend: 'Add' },
  { Id: 'REyeSquint', Value: 0.35, Blend: 'Add' },
  { Id: 'ParamBrowLY', Value: -0.25, Blend: 'Add' },
  { Id: 'ParamBrowRY', Value: -0.25, Blend: 'Add' },
  { Id: 'ParamBrowLAngle', Value: -0.8, Blend: 'Add' },
  { Id: 'ParamBrowRAngle', Value: 0.8, Blend: 'Add' },
]
function crotchFace(on) {
  if (!state.layers) return
  if (!on) { try { state.layers.removeSource('crotch-face') } catch {}; return }
  try { state.layers.addExpression('胯部神态', CROTCH_FACE, { source: 'crotch-face', fade: 0.28 }) } catch {}
}

/**
 * 执行一条互动差分：表情 → 自定义参数 → 嘴形 → 动作 → 台词。
 *
 * 表情走 reactions.apply 的 override，是为了沿用它的「同一组切换不叠加 / 到点自动撤」规则；
 * 热区本身没配这套反应（比如捏脸的下压给的是 down）时才用独立 source 自己上。
 * **开关型反应（脱鞋 / 换裙 / 尾巴开关 / 胸口衣服）只照旧切换**，差分不改开关语义，
 * 只换「切的时候说什么、什么表情、什么嘴形」。
 */
function applyVariant(name, kind, v, { rxRegion = null, ms = 0 } = {}) {
  if (!v) return false
  const region = rxRegion || { name }
  const def = region.reaction?.[kind] || state.reactions?.table?.[name]?.[kind]
  const hold = Number(ms) > 0 ? Number(ms) : (Number(v.ms) > 0 ? Number(v.ms) : 2600)

  if (v.expr?.length) {
    if (def && !def.toggle) {
      state.reactions.apply(region, kind, { expr: v.expr })
    } else if (!def) {
      for (const n of v.expr) {
        const d = (state.caps?.expressions || []).find((e) => e.name === n)
        if (d) state.layers?.addExpression(n, d.params, { source: 'variant', fade: 0.25 })
      }
      clearTimeout(state.variantExprHold)
      state.variantExprHold = setTimeout(() => {
        try { state.layers?.removeSource('variant') } catch {}
      }, hold)
    }
    // def.toggle：开关表情由 reactions 自己管，差分的 expr 让位，避免和脱鞋/换裙表情打架
  } else if (def) {
    state.reactions.apply(region, kind)
  }

  if (v.params?.length) {
    try { state.layers?.addExpression(`差分:${v.id}`, v.params, { source: 'variant-params', fade: 0.25 }) } catch {}
    clearTimeout(state.variantParamHold)
    state.variantParamHold = setTimeout(() => {
      try { state.layers?.removeSource('variant-params') } catch {}
    }, hold)
  }

  if (v.mouth) {
    const { ms: mouthMs, ...shape } = v.mouth
    state.mouth?.setMood?.(shape, Number(mouthMs) > 0 ? Number(mouthMs) : hold)
  }
  if (v.act) state.idle?.trigger?.(v.act, { manual: true })
  let said = null
  if (v.line) {
    said = state.bubble?.sayText?.(v.line, { ms: hold })
    // agent 干活时气泡被锁（working / thinking）：用户亲手摸她，该让互动说话；
    // 但「等你确认」（waiting）不抢 —— 那是要用户处理的，被一句撒娇顶掉会误事。
    if (!said && state.bubble?.state?.().state !== 'waiting') {
      try { state.bubble?.unlock?.('agent') } catch {}
      said = state.bubble?.sayText?.(v.line, { ms: hold })
    }
  }
  // 诊断记录：气泡可能立刻被 agent 的下一轮状态覆盖，这里留下「差分确实执行过」的证据
  state.lastVariant = {
    at: Date.now(), name, kind, id: v.id,
    line: v.line || '', said: !!said,
    expr: v.expr || null, act: v.act || null,
    bubbleState: state.bubble?.state?.().state ?? null,
    // 表情走了哪条路：diff = 差分覆盖，default = 分区默认反应，none = 没配
    path: v.expr?.length ? 'diff' : (def ? `default:${def.toggle ? 'toggle' : 'expr'}` : 'none'),
    defExpr: def?.expr || null,
    layersAfter: (state.layers?.inspect?.()?.layers || []).map((l) => `${l.source}:${l.name}`),
  }
  return true
}

/** 抽一条差分并执行；返回抽中的差分（没命中返回 null，调用方走旧的固定反应） */
function runVariant(name, kind, opts) {
  const v = state.variants?.pick?.(name, kind)
  if (!v) return null
  applyVariant(name, kind, v, opts)
  return v
}

/**
 * 模型三态：常态 → 爱心眼 → 黑框眼镜（点额头循环）。
 * source 独立（'mode'），不和分区反应 / agent 表情互相覆盖。
 */
const MODE_LIST = ['常态', '爱心眼', '黑框眼镜']
let modeName = '常态'
function applyMode(name) {
  const next = MODE_LIST.includes(name) ? name : '常态'
  modeName = next
  if (!state.layers) return next
  // 三态互斥：爱心眼 / 眼镜不管来自哪一层（额头循环、点头部的 switch 层、手动按钮）都先清掉，
  // 否则爱心眼会一直挂在脸上，切回常态也消不掉
  for (const n of ['爱心眼', '黑框眼镜']) {
    try { state.layers.removeExpression(n) } catch {}
  }
  try { state.layers.removeSource('mode') } catch {}
  if (next !== '常态') {
    const def = (state.caps?.expressions || []).find((e) => e.name === next)
    if (def) {
      try { state.layers.addExpression(next, def.params, { source: 'mode', fade: 0.22 }) } catch {}
    }
  }
  return next
}
function cycleMode() {
  const i = MODE_LIST.indexOf(modeName)
  return applyMode(MODE_LIST[(i + 1) % MODE_LIST.length])
}

/**
 * 体型：模型用 `Clothes2` 参数切（默认体型 0 / 体型1 0.4 / 体型2 1）。
 * 原包是三个表达式，这里改成连续拉条，设置里拖到哪里就是哪里。
 */
function applyBodyShape(v) {
  const val = Math.max(0, Math.min(1, Number(v) || 0))
  state.bodyShape = val
  if (!state.layers) return val
  try { state.layers.removeSource('body') } catch {}
  try { state.layers.addExpression('体型', [{ Id: 'Clothes2', Value: val, Blend: 'Add' }], { source: 'body', fade: 0.25 }) } catch {}
  // 体型一变，身体网格就整片换位置：热区是按网格铺的，必须跟着重算。
  // 防抖 500ms —— 设置里拉条是连续的，不防抖会每帧重铺一次。
  scheduleZoneRefresh(500)
  return val
}

/** 触摸动作 → 台词档（tap / pet 分开；脚和腰的 pet 由「痒痒的」统一说话，这里不重复） */
const TOUCH_PHRASE = {
  头: { tap: 'head', pet: 'head' },
  胸: { tap: 'chest', pet: 'chest' },
  腰: { tap: 'waistTap' },
  裙摆: { tap: 'skirt', pet: 'skirt' },
  腿: { tap: 'legs', pet: 'legs' },
  脚: { tap: 'foot' },
  左手: { pet: 'handPet' },
  右手: { pet: 'handPet' },
  胯: { tap: 'crotchTap' },
  尾巴: { tap: 'tail', pet: 'tailPet' },
}

/**
 * 热区迁移表。
 * 每条 = 「这几个热区应该有几块、当前版本号是多少、不够或过旧时怎么重建」。
 * 以前是三个手写的 if 链堆在 bootRegions 里（脸 V3 / 手 V1 / 胯 V1），加一个热区就要
 * 再抄一段；现在加新热区只是往表里加一条。
 */
const ZONE_MIGRATIONS = [
  {
    // 脸部热区（捏脸用）：左右各一个，眼睛以上仍归头部；老档案（单个「脸」）自动迁移
    names: ['左脸', '右脸'],
    version: 3,
    build: ({ core, internalModel, displayNames, canvas }) => (
      faceRegions({ core, internalModel, displayNames, canvas }).map((r) => ({ ...r, reaction: {} }))
    ),
  },
  {
    // 手部热区：两只手垂在裙摆两侧、又会随身体摆，固定矩形必然错位，所以按网格周期重算
    names: ['左手', '右手'],
    version: 1,
    build: ({ handReader }) => handReader.read().map((r) => ({ ...r, reaction: DEFAULT_REACTIONS[r.name] || {} })),
  },
  {
    // 额头热区：点一下切换 常态 / 爱心眼 / 眼镜（层级压过「头」，才抢得到点击）
    names: ['额头'],
    version: 1,
    build: ({ core, internalModel, displayNames, canvas }) => (
      foreheadRegion({ core, internalModel, displayNames, canvas }).map((r) => ({ ...r, reaction: {} }))
    ),
  },
  // 胯部热区曾经也在这里迁移，但它是按画布比例写死的（41.5%–50.5%），
  // 体型一拉成 Q 版就整块落空。现在改由 seedRegions 按身体锚点出，
  // 再由 refreshBodyZones 周期校正 —— 旧档案里那份会被第一次重算替换掉。
]

/**
 * 热区迁移。注意一个容易踩的时序坑：
 * 脸/手/额头是拿**当前蒙皮顶点**铺的，而模型在启动时可能还没更新过一帧 ——
 * 那时顶点是空的，`build()` 返回 []，迁移「没报错也没加东西」，看起来成功，
 * 实际结果是捏脸/点手/额头全没了（而且下一次身体热区重算会把这份残缺存档写下去）。
 * 所以：调用方先保证补过一帧（见 bootRegions），这里再加一层「有组缺失就下一帧重试」的兜底。
 */
function migrateZones(ctx, attempt = 0) {
  for (const m of ZONE_MIGRATIONS) {
    const cur = state.store.all.filter((r) => m.names.includes(r.name))
    const upToDate = cur.length === m.names.length && cur.every((r) => r.v === m.version)
    if (upToDate) continue
    for (const r of cur) state.store.remove(r.id)
    let fresh = []
    try { fresh = m.build(ctx) || [] } catch (e) {
      // 迁移失败不要静默：以前这里 catch 成空数组，直接把热区丢掉且毫无痕迹
      console.warn('[zones] 迁移失败', m.names.join('/'), e)
      continue // 保留旧的热区，下次启动再试
    }
    for (const z of fresh) state.store.add({ ...z, v: m.version })
    if (fresh.length) state.store.save(ctx.key)
  }
  // 兜底：模型顶点还没就绪时会整组铺空。别把它当成「迁移完成」，下一帧再补一次（最多 3 次）。
  const missing = ZONE_MIGRATIONS.filter((m) => !state.store.all.some((r) => m.names.includes(r.name)))
  if (missing.length && attempt < 3) {
    requestAnimationFrame(() => {
      try { migrateZones(ctx, attempt + 1) } catch (e) { console.warn('[zones] 迁移重试失败', e) }
    })
  }
}

/**
 * 身体热区「该不该重铺」的签名：只读换装/体型这几个参数（便宜），不读顶点。
 * 为什么不用「每 2 秒重铺一次」：模型待机时头会晃，实测同一份热区两次采样能漂 89px，
 * 每 2 秒重铺等于让热区跟着呼吸抖，还会不停写 localStorage。真正会改身体网格的是这五个参数。
 */
const ZONE_MATERIAL_PARAMS = ['Clothes1', 'Clothes2', 'Clothes3', 'Clothes4', 'Clothes5']
// 只有这些表达式会换网格；表情（脸红/眼型…）不该牵动热区，更不该牵动居中
const ZONE_LAYER_KEYS = ['裙子切换', '脱鞋', '尾巴开关', '胸口衣服', '体型', '体型1', '体型2']
function zoneMaterialSig() {
  let params = ''
  try {
    params = ZONE_MATERIAL_PARAMS.map((id) => {
      const v = state.stage.param.get(id)
      return v == null ? '-' : Number(v).toFixed(2)
    }).join(',')
  } catch { params = '' }
  // 换装也可能走表达式层（裙子切换 / 脱鞋 / 尾巴开关…）：表达式参数每帧被模型基线
  // 重置，只读参数读不出换装，所以层名也算进签名。
  const layersSig = (state.layers?.expressions?.() || []).filter((n) => ZONE_LAYER_KEYS.includes(n)).join('|')
  return `${params}#${layersSig}`
}

/** 按当前身体网格重铺一版「身体段」热区（头/胸/腰/裙摆/腿/脚/尾巴/胯） */
function seedBodyZones() {
  return seedRegions({
    core: state.stage.core,
    internalModel: state.stage.model.internalModel,
    displayNames: state.partNames,
    canvas: state.stage.modelSize(),
  })
}

const samePts = (a, b) => Array.isArray(a) && Array.isArray(b) &&
  a.length === b.length &&
  a.every((p, i) => Math.abs(p[0] - b[i][0]) < 0.6 && Math.abs(p[1] - b[i][1]) < 0.6)

const sameRings = (a = [], b = []) => a.length === b.length && a.every((ring, i) => samePts(ring, b[i]))

/**
 * 身体热区重算：换装（短裙↔长裙）、体型拉条（Clothes2，含 Q 版）会换掉身体网格，
 * 而热区多边形是「按网格铺一次」的静态数据 —— 不重算就等于拿旧地图找人。
 * 这里只改几何：id / reaction / 用户自己画的其它热区一律不碰；没变化就不写存档。
 */
function refreshBodyZones() {
  if (!state.store || !state.stage?.core) return false
  let fresh = []
  try { fresh = seedBodyZones() } catch (e) { console.warn('[zones] 重算失败', e); return false }
  // 长裙/短裙决定的「腿 ↔ 长裙」让位关系，跟身体段一起刷新
  syncSkirtZone()
  if (!fresh.length) return false
  let dirty = false
  for (const z of fresh) {
    const old = state.store.all.find((r) => r.name === z.name)
    if (!old) {
      state.store.add({ ...z, reaction: DEFAULT_REACTIONS[z.name] || {} })
      dirty = true
      continue
    }
    if (samePts(old.points, z.points) && sameRings(old.holes, z.holes || [])) continue
    old.points = z.points
    old.holes = z.holes || []
    old.z = z.z
    dirty = true
  }
  if (dirty) {
    try { state.store.save(state.caps.model.name) } catch {}
    state.recomputePass?.()
    // 只有**体型/裙装**换了才重算居中。热区重铺每次都会因为待机摆动差几像素，
    // 以前这里无条件 recenter，等于让窗口跟着呼吸抽动（用户看到的「角色自己位移」）。
    const key = `${Math.round((state.bodyShape ?? 0) * 100)}|${skirtIsLong() ? 1 : 0}`
    if (key !== state.fitKey) {
      state.fitKey = key
      scheduleRecenter()
    }
  }
  state.zoneSig = zoneMaterialSig()
  // 体型=标准值时顺手记下「标准头高」，作为放大曲线的基准（第一次装、或用户拉回 0 时自愈）
  noteFitRef()
  return dirty
}

/** 拉条/换装是连续的，重算要防抖；叠几次也无所谓，最后都会收敛到同一份几何 */
let zoneVerifyTimer = 0
let zoneVerifyCount = 0
function scheduleZoneRefresh(ms = 400) {
  clearTimeout(state.zoneRefreshTimer)
  clearTimeout(zoneVerifyTimer)
  zoneVerifyCount = 0
  state.zoneRefreshTimer = setTimeout(() => {
    state.zoneRefreshTimer = 0
    runZoneRefresh()
  }, ms)
}

/**
 * 重铺一次 + 校验一次。
 * 体型的表达式是淡入的、姿势插值也要几百毫秒，重铺如果正好落在变形中间态，
 * 热区和放大倍数就会停在中间值（实测差 9%）。所以铺完 700ms 再量一次，
 * 差得多才重铺；差得少说明只是待机摆动（实测 2 秒能晃 89px），忽略——别让热区跟着呼吸抖。
 */
function runZoneRefresh() {
  refreshBodyZones()
  const before = bodySpan()
  clearTimeout(zoneVerifyTimer)
  if (zoneVerifyCount >= 3) return
  zoneVerifyCount += 1
  zoneVerifyTimer = setTimeout(() => {
    zoneVerifyTimer = 0
    refreshBodyZones()
    const after = bodySpan()
    if (before && after && before.h > 0 && Math.abs(after.h - before.h) > before.h * 0.012) {
      runZoneRefresh()
    }
  }, 700)
}

/**
 * 尾巴隐藏后的「找回来」入口。
 * 尾巴开关（Clothes5）一开，尾巴像素就没了 → 窗口级 alpha 掩码判定「指针不在角色身上」→
 * 直接穿透给桌面，那块热区永远收不到事件。所以隐藏态必须给一个不依赖透明像素的 DOM 元素：
 * 白底蓝边的气泡，贴在尾巴原来的位置（热区里最靠上的那个点 = 尾尖），
 * 里面是 DeepSeek 官方蓝的鲸鱼图标，点一下就长回来 —— 比角落按钮更像她身上的一部分。
 */
// 尾巴气泡：圆形、白底蓝边，里面是 DeepSeek 的蓝鲸 logo（官方蓝 #4d6bfe）
const DS_LOGO = '/assets/deepseek-logo.png'

/**
 * 尾巴藏起来之后的找回入口。
 * 尾巴开关（Clothes5）一开，尾巴像素全透明 → 窗口级 alpha 掩码判定「指针不在角色身上」
 * → 指针直接穿透给桌面，尾巴热区永远收不到事件。所以必须有一个不依赖像素的 DOM 元素：
 * 圆形气泡 + DeepSeek 蓝鲸 logo，贴在大腿中部**外侧**（不压腿），点一下尾巴就长回来。
 */
function tailBubbleMetrics() {
  const legs = state.store?.all?.find((x) => x.name === '腿')
  if (!legs?.points?.length || !state.viewport) return null
  const chest = state.store?.all?.find((x) => x.name === '胸')
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const [x, y] of legs.points) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  // 直径 ≈ 一侧乳房：按胸宽的一半算（模型坐标），再换算成屏幕像素
  let chestW = x1 - x0
  if (chest?.points?.length) {
    let cx0 = Infinity, cx1 = -Infinity
    for (const [x] of chest.points) { if (x < cx0) cx0 = x; if (x > cx1) cx1 = x }
    if (cx1 - cx0 > 80) chestW = cx1 - cx0
  }
  const rModel = Math.max(80, chestW * 0.25)
  // 纵向：大腿中部 = 胯底 → 脚踝顶 的 55%。
  // 不能直接取「腿」热区的中点：穿长裙时腿被挡住、热区只剩小腿，气泡会掉到脚踝。
  let thighY = y0 + (y1 - y0) * 0.5
  const hip = state.store?.all?.find((x) => x.name === '胯')
  const foot = state.store?.all?.find((x) => x.name === '脚')
  if (hip?.points?.length && foot?.points?.length) {
    let hy = -Infinity, fy = Infinity
    for (const [, y] of hip.points) if (y > hy) hy = y
    for (const [, y] of foot.points) if (y < fy) fy = y
    if (Number.isFinite(hy) && Number.isFinite(fy) && fy - hy > 200) thighY = hy + (fy - hy) * 0.55
  }
  // 横向：腿外缘再往外一个半径 + 一点缝 = 不遮大腿
  const cx = x1 + rModel * 1.12
  const cy = thighY
  const a = state.viewport.modelToScreen(cx, cy)
  const b = state.viewport.modelToScreen(cx + rModel, cy)
  const r = Math.abs(b.x - a.x)
  return { x: a.x, y: a.y, d: Math.round(Math.max(30, r * 2)) }
}

function placeTailRestore(el) {
  if (!el || !el.classList.contains('on')) return
  const m = tailBubbleMetrics()
  if (!m) return
  const W = window.innerWidth, H = window.innerHeight
  el.style.width = `${m.d}px`
  el.style.height = `${m.d}px`
  el.style.left = `${Math.round(Math.max(6, Math.min(W - m.d - 6, m.x - m.d / 2)))}px`
  el.style.top = `${Math.round(Math.max(6, Math.min(H - m.d - 6, m.y - m.d / 2)))}px`
}

function syncTailRestore() {
  const hidden = !!state.layers?.hasExpression?.('尾巴开关')
  let el = $('#tail-restore')
  if (!el) {
    el = document.createElement('button')
    el.id = 'tail-restore'
    el.type = 'button'
    el.title = '显示尾巴'
    el.setAttribute('aria-label', '显示尾巴')
    el.innerHTML = `<img src="${DS_LOGO}" alt="" draggable="false">`
    el.addEventListener('click', () => {
      try { state.layers.removeExpression('尾巴开关') } catch {}
      toast('尾巴回来啦')
      state.recomputePass?.()
      syncTailRestore()
    })
    document.body.appendChild(el)
  }
  el.classList.toggle('on', hidden)
  if (hidden) requestAnimationFrame(() => placeTailRestore(el))
}

// ---------- 长裙态：腿被裙子挡住，改用「长裙」热区 ----------
/**
 * 现在是不是长裙。
 * 不能用 `param.get('Clothes1')` 判断：表达式是在 `coreModel.update` 之前逐帧写进去的，
 * 帧间读出来永远是被模型基线重置过的 1（短裙）。真正可靠的状态 = 层里有没有「裙子切换」。
 */
function skirtIsLong() {
  return !!state.layers?.hasExpression?.('裙子切换')
}

/**
 * 长裙 ↔ 短裙时热区要换一套：
 *   长裙：腿被裙子完全挡住（现实里不该还能摸腿）→ 腿热区停用，长出「长裙」热区
 *         （点 = 换回短裙，滑 = 让她转个身），
 *   短裙：长裙热区停用，腿恢复。
 * 只动这两块，其它热区（含用户手画的、手/脸/尾巴）一律不碰。
 */
function syncSkirtZone() {
  if (!state.store || !state.stage?.core) return
  const long = skirtIsLong()
  const legs = state.store.all.find((r) => r.name === '腿')
  if (legs) legs.disabled = long
  const cur = state.store.all.find((r) => r.name === '长裙')
  if (!long) { if (cur) cur.disabled = true; return }
  let fresh = null
  try {
    fresh = longSkirtRegion({
      core: state.stage.core,
      internalModel: state.stage.model.internalModel,
      displayNames: state.partNames,
      canvas: state.stage.modelSize(),
    })
  } catch { fresh = null }
  if (!fresh) { if (cur) cur.disabled = true; return }
  if (!cur) {
    state.store.add({ ...fresh, reaction: DEFAULT_REACTIONS['长裙'] || {} })
    state.recomputePass?.()
    return
  }
  const moved = !samePts(cur.points, fresh.points)
  cur.points = fresh.points
  cur.z = fresh.z
  cur.disabled = false
  if (moved) state.recomputePass?.()
}

/**
 * 长裙滑动：身体左右轻轻转两下（只借胸腔/骨盆的转动参数抖一下，不换姿势），
 * 裙摆跟着荡，嘴上是「觉得我穿长裙好看吗」那套。用完就撤，不留状态。
 */
/**
 * 长短裙开关：唯一入口（RPC / 意图 / 点裙子 都走这里）。
 * 关掉 = 回短裙；打开 = 加「裙子切换」表达式层。换完立刻重铺热区。
 */
function setSkirtLong(long) {
  state.layers?.removeExpression?.('裙子切换')
  if (long) {
    const def = (state.caps?.expressions || []).find((e) => e.name === '裙子切换')
    if (def) state.layers?.addExpression('裙子切换', def.params, { source: 'manual', fade: 0.25 })
  }
  scheduleZoneRefresh(200)
  return skirtIsLong()
}

function skirtSway(amp = 16) {
  const L = state.layers
  if (!L) return
  const v = clampNum(amp, 1, 30, 16)
  const pose = (v) => {
    L.removeExpression('skirtSway')
    // 胸腔侧倾 + 骨盆反向 + 一点转动：看着像「提着裙摆左右晃一下」，而不是整个人歪倒
    L.addExpression('skirtSway', [
      { Id: 'ParamBodyAngleZ', Value: v * 0.45, Blend: 'Add' },
      { Id: 'HipAngleZ', Value: -v * 0.32, Blend: 'Add' },
      { Id: 'ParamBodyAngleY', Value: v * 0.3, Blend: 'Add' },
    ], { source: 'skirt', fade: 0.18 })
  }
  pose(v)
  clearTimeout(state.skirtSwayA)
  clearTimeout(state.skirtSwayB)
  state.skirtSwayA = setTimeout(() => pose(-v), 520)
  state.skirtSwayB = setTimeout(() => { L.removeExpression('skirtSway') }, 1080)
}

/**
 * 抚胸时胸口被手盖住 → 胸热区停用（和「摸胸」预设的语义一致：手在胸口时摸不到胸）。
 * 手放下或换回垂手就恢复。放在 1s 心跳里跟状态走，不依赖点击路径。
 */
function syncChestZone() {
  const chest = state.store?.all?.find((r) => r.name === '胸')
  if (!chest) return
  const covered = (state.poses?.state?.()?.hands?.right || '') === '抚胸'
  if (chest.disabled !== covered) {
    chest.disabled = covered
    state.recomputePass?.()
  }
}

/**
 * 抬手后的热区延展。
 * 模型的抬手是**换图**，手部网格会换到另一批 drawable，热区读取器跟不到它 ——
 * 表现就是「举手之后点不到那只手，只能点另一只手把它放下」。所以按状态把热区铺过去：
 *   · 竖食指：手在脸旁 → 热区沿手臂向上延到头部下沿，z 提到 9（压过脸，点得到）
 *   · 抚胸：手盖在胸口 → 热区朝身体中线铺开（此时胸热区已停用，不抢）
 * 放下后恢复读取器给的原始矩形与 z=8。
 */
function stretchHandZones() {
  if (!state.store) return
  const hands = state.poses?.state?.()?.hands || {}
  const head = state.store.all.find((r) => r.name === '头')
  const chest = state.store.all.find((r) => r.name === '胸')
  const bbox = (r) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of r.points || []) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return { x0, y0, x1, y1 }
  }
  const headB = head?.points?.length ? bbox(head) : null
  const chestB = chest?.points?.length ? bbox(chest) : null
  for (const r of state.store.all) {
    if (r.name !== '左手' && r.name !== '右手') continue
    const base = r._base || r.points
    if (!base?.length) continue
    const b = bbox({ points: base })
    let { x0, y0, x1, y1 } = b
    // 画面右 = 角色左手 = 食指手；画面左 = 角色右手 = 抚胸手
    const indexing = r.name === '右手' && hands.left === '竖手指'
    const onChest = r.name === '左手' && hands.right === '抚胸'
    if (indexing && headB) {
      // 手指到了下巴高度：热区向上长到头部下沿，左右各放宽一些（手是细长条，
      // 不放宽的话点在手边缘会落空）。脸在头部中间偏左，放宽到这里也抢不到捏脸。
      const w = x1 - x0
      x0 -= w * 0.5
      x1 += w * 0.25
      y0 = Math.min(y0, headB.y0 + (headB.y1 - headB.y0) * 0.18)
      r.z = 9
    } else if (onChest && chestB) {
      // 手盖在胸口：热区铺到胸口（胸已停用，不会打架）
      const cx = (chestB.x0 + chestB.x1) / 2
      x1 = Math.max(x1, cx + (x1 - x0) * 0.35)
      x0 = Math.min(x0, cx - (x1 - x0) * 0.9)
      y0 = Math.min(y0, chestB.y0)
      y1 = Math.max(y1, chestB.y1)
      r.z = 9
    } else {
      r.z = 8
    }
    r.points = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  }
}

function bootRegions() {
  const key = state.caps.model.name
  // 热区是拿「当前蒙皮顶点」铺的 —— 模型一帧都没更新过时顶点是空的，
  // 脸/手/额头就会铺成 []（迁移不报错、也不加东西）→ 捏脸和点手直接失效。
  // 启动时先补一帧更新，保证后面的构建器读到的是有效顶点。
  try { state.stage.advance?.(1000 / 60) } catch {}
  state.store = createRegionStore([])
  const bands = ['头', '胸', '腰', '裙摆', '腿', '脚', '尾巴']
  // 部件 id → 显示名走 Map：原来每次都是一次 148 项线性查找，采样期被调用上百次
  const partNameById = new Map((state.caps.parts || []).map((p) => [p.id, p.name]))
  const names = {
    get: (i) => {
      try { return partNameById.get(csmName(state.stage.core.getPartId(i))) || '' } catch { return '' }
    },
  }
  // 身体段热区重算要用同一张「部件 id → 名字」表
  state.partNames = names
  const loaded = state.store.load(key)
  // 补丁里的热区优先落地（用户拿原模型 + 补丁即可复现同一套热区）
  if (state.patch?.regions?.regions?.length) state.store.loadJSON(state.patch.regions)
  const missing = loaded ? bands.filter((n) => !state.store.all.some((r) => r.name === n)) : bands
  if (!loaded || missing.length) {
    const seeded = seedRegions({
      core: state.stage.core,
      internalModel: state.stage.model.internalModel,
      displayNames: names,
      canvas: state.stage.modelSize(),
    })
    for (const r of state.store.all.slice()) state.store.remove(r.id)
    for (const r of seeded) state.store.add({ ...r, reaction: DEFAULT_REACTIONS[r.name] || {} })
    state.store.save(key)
  }

  // 手部热区读取器：迁移与周期重算共用同一个（索引表内部缓存）
  const handReader = createHandZoneReader({
    core: state.stage.core,
    internalModel: state.stage.model.internalModel,
    displayNames: names,
    canvas: state.stage.modelSize(),
  })
  state.handReader = handReader

  // 热区版本迁移（脸 V3 / 手 V1 / 胯 V1）：缺了就补，版本旧了就重建，不改动其它热区
  migrateZones({
    key,
    handReader,
    core: state.stage.core,
    internalModel: state.stage.model.internalModel,
    displayNames: names,
    canvas: state.stage.modelSize(),
  })

  // 身体段热区按当前网格重算：启动先校正一次（旧档案里写死比例的「胯」会顺手换成锚点版）。
  // 之后每秒只看一次「换装 / 体型」签名，变了才重铺 —— 姿势微动不重铺，
  // 否则热区会跟着待机晃（实测能漂 89px），而且每两秒写一次存档。
  state.zoneSig = zoneMaterialSig()
  // 放大曲线的基准：先读存档（换模型各存各的），读不到就用「画布高 × 比例」兜底
  const fitRef = loadFitRef()
  state.fitRefHead = Number(fitRef?.head) || 0
  state.fitRefSpan = Number(fitRef?.span) || 0
  refreshBodyZones()
  syncTailRestore()
  setInterval(() => {
    if (zoneMaterialSig() !== state.zoneSig) refreshBodyZones()
    syncTailRestore()
    syncChestZone()
  }, 1000)

  // 左/右脸热区要**跟着变形走**：前倾这类动作会让脸整体下移，
  // 热区若固定在初始位置就会「摸脸点到胸」。这里按当前蒙皮顶点周期重算（只改内存，不改存档）。
  function startFaceRegionTracking(partNames) {
    // 索引表缓存一次，之后每次只取那几个 drawable 的顶点（原来每次都要全量扫 715 个）
    const reader = createFaceZoneReader({
      core: state.stage.core,
      internalModel: state.stage.model.internalModel,
      displayNames: partNames,
      canvas: state.stage.modelSize(),
    })
    state.faceReader = reader
    setInterval(() => {
      const cur = state.store.all.filter((r) => r.name === '左脸' || r.name === '右脸')
      if (cur.length === 2) {
        let fresh = []
        perf.time('face', () => {
          try { fresh = reader.read() } catch { fresh = [] }
        })
        if (fresh.length === 2) {
          for (const r of cur) {
            const f = fresh.find((x) => x.name === r.name)
            if (f) r.points = f.points
          }
        }
      }
      // 额头跟着脸一起重算（前倾/歪头时整张脸会移动）
      const fore = state.store.all.find((r) => r.name === '额头')
      if (fore) {
        try { const pts = reader.readForehead?.(); if (pts) fore.points = pts } catch {}
      }
      // 手和脸用同一个心跳：各自缓存索引表，单次都是亚毫秒级
      const hands = state.store.all.filter((r) => r.name === '左手' || r.name === '右手')
      if (hands.length === 2) {
        let freshHands = []
        perf.time('hand', () => {
          try { freshHands = state.handReader.read() } catch { freshHands = [] }
        })
        // 手区分配**按屏幕左右**：读取器在抬手时会换图、还会把左右标签调换，
        // 直接信它的名字会让「点举着的手」点到另一只。这里按包围盒中心排序重新指派。
        const cxb = (pts) => (pts[0][0] + pts[2][0]) / 2
        // 读取器按「所有手部顶点的中线」切两簇：只剩一只手可见时，同一只手会被切成
        // 两块（手指 / 手掌），于是凭空多出一只「右手」。距离过近就合成一只。
        if (freshHands.length >= 2) {
          const [a, b] = freshHands
          const wa = a.points[1][0] - a.points[0][0]
          const wb = b.points[1][0] - b.points[0][0]
          if (Math.abs(cxb(a.points) - cxb(b.points)) < (wa + wb) * 0.9) {
            const x0 = Math.min(a.points[0][0], b.points[0][0])
            const x1 = Math.max(a.points[1][0], b.points[1][0])
            const y0 = Math.min(a.points[0][1], b.points[0][1])
            const y1 = Math.max(a.points[2][1], b.points[2][1])
            freshHands.length = 0
            freshHands.push({ name: '手', points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] })
          }
        }
        if (freshHands.length >= 2) {
          const sorted = freshHands.slice(0, 2).sort((a, b) => cxb(a.points) - cxb(b.points))
          for (const r of hands) {
            const f = r.name === '左手' ? sorted[0] : sorted[1]
            if (f) { r.points = f.points; r._base = f.points }
          }
        } else if (freshHands.length === 1) {
          // 只剩一只手可见（另一只被姿势换图藏了）：按离旧位置最近分配给其中一只，
          // 另一只保留上次的几何，稍后由 stretchHandZones 按状态延展过去。
          const f = freshHands[0]
          const cx = cxb(f.points)
          let best = null
          for (const r of hands) {
            const b = r._base || r.points
            if (!b?.length) continue
            const d = Math.abs((b[0][0] + b[2][0]) / 2 - cx)
            if (!best || d < best.d) best = { r, d }
          }
          if (best) { best.r.points = f.points; best.r._base = f.points }
        }
        // 手抬起来后，热区要盖住「人看到的那只手」，否则点不到、放下只能靠点另一只手
        stretchHandZones()
      }
    }, 80)
  }

  state.regionInput = createRegionInput({
    store: state.store,
    viewport: state.viewport,
    canvas: $('#stage'),
    // 透明处穿透：热区是矩形/凸包，边角必然盖到透明背景。
    // 几何命中之后再过一道「这一像素到底画没画东西」——SPEC §5 写了这道关，
    // 但 createRegionInput 一直没收到 isOpaque，等于整条门控从来没生效。
    // 只在按下/起手采纳这两个低频时机调，不进移动路径。
    isOpaque: (p) => {
      try {
        const sp = state.viewport.modelToScreen(p.x, p.y)
        const r = state.stage.sampleAlpha(sp.x, sp.y)
        if (!r || r.alpha == null) return true // 采样失败放行，别把互动锁死
        return r.alpha > 16
      } catch { return true }
    },
    isNear: (sp) => {
      const s = state.stage.size()
      const m = 8
      return sp.x >= -m && sp.y >= -m && sp.x <= s.width + m && sp.y <= s.height + m
    },
    onEvent: (ev) => {
      const rawName = ev.region?.name
      // 额头热区只管「点击切三态」；抚摸/拖动仍按头部处理，否则滑动摸头会被额头吃掉
      const name = rawName === '额头' && ev.type !== 'tap' ? '头' : rawName
      // 上行反馈：真正发生的互动（点 / 摸第一步 / 拖）才报，避免移动刷屏
      if (ev.type === 'tap' || (ev.type === 'pet' && ev.step === 1) || ev.type === 'dragStart' || ev.type === 'dragEnd') {
        const p = ev.point || {}
        // 时间序列：只记真正有语义的互动（点 / 摸第一步 / 拖起拖放），移动过程不记
        if (ev.type !== 'dragEnd') {
          state.history?.push({
            kind: 'touch',
            region: name || '背景',
            gesture: ev.type === 'tap' ? 'click' : ev.type === 'dragStart' ? 'drag' : 'pet',
          })
          // 互动攒情绪：被摸胯会生气+害羞，被摸头会开心+害羞…
          for (const [m, amt] of moodForTouch(name || '', ev.type === 'tap' ? 'tap' : ev.type === 'dragStart' ? 'drag' : 'pet')) {
            state.mood?.bump?.(m, amt)
          }
        }
        emitFeedback({
          type: 'interaction',
          region: name || null,
          gesture: ev.type === 'tap' ? 'click' : ev.type === 'dragStart' || ev.type === 'dragEnd' ? 'drag' : 'pet',
          detail: ev.type === 'pet' ? `step ${ev.step}` : null,
          at: { x: Math.round(p.x ?? 0), y: Math.round(p.y ?? 0) },
        }, state.settings?.token)
      }
      const isHand = name === '左手' || name === '右手'
      // 一互动就让「随机小表情」让位：否则摸胯这种强情绪会被待机脸插一个
      // 「吐舌头 + 眨一只眼」，串成完全不相干的可爱风。
      if (ev.type === 'down' || ev.type === 'tap' || ev.type === 'pet' || ev.type === 'dragStart') {
        state.idleFaces?.pause?.(5200)
      }
      // 摸尾巴：一整套连续反应（扭腰甩尾 → 躲一下 → 偷看 → ＞＜ + 脸红 + 台词）。
      // 必须在「一互动就 reset 待机」之前拦下来：手顺着尾巴滑到别处时，
      // 后续每个 pet step 都会 reset 一遍，把刚起的动作清掉、台词也换成「别摸腿」。
      // 所以：第一下起手后开一个 3.2s 窗口，窗口内的抚摸事件全部忽略。
      if (ev.type === 'pet' && name === '尾巴') {
        if (performance.now() >= (state.tailPetUntil || 0)) {
          state.tailPetUntil = performance.now() + 3200
          state.idle?.trigger?.('被摸尾巴', { manual: true })
          // 甩尾走独立写入层（见 bootStage 第 ③ 个 onBeforeUpdate）：动作系统的 holds 会被
          // poseBus.flush 覆盖，光靠 holds 身体/尾巴是不动的
          state.tailWag = { t0: performance.now(), ms: 3000 }
          // 传一个「没有 reaction 字段」的干净对象：热区几何是存档里的旧快照，
          // 它的 reaction 可能还是改版前的（尾巴只有 ＞＜），会盖掉 DEFAULT_REACTIONS 的新配置
          // 台词与神态交给差分（傲娇 / 害羞 / 放任 / 否认），甩尾时长 3200 与动作对齐
          if (!runVariant('尾巴', 'pet', { rxRegion: { name: '尾巴' }, ms: 3200 })) {
            state.reactions.apply({ name: '尾巴' }, 'pet')
            state.bubble?.say('tailPet', { ms: 3200 })
          }
        }
        return
      }
      if (ev.type === 'pet' && performance.now() < (state.tailPetUntil || 0)) return
      // 手已经护在胸口（抚胸）时还接着摸 = 越界：改成防御反应（扭两下 + 别开脸 + 脸红 + 台词）。
      // 必须在「一互动就 reset 待机」之前拦下来：否则后续每个 pet step 都会把刚起的防御动作清掉。
      // 胸热区这时候是停用的，摸到的是盖在胸口的那只手（热区名「左手」）。
      const guardingChest = (state.poses?.state?.()?.hands?.right || '') === '抚胸' &&
        (name === '胸' || (isHand && name === '左手'))
      if (guardingChest && ev.type === 'pet') {
        if (ev.step === 1) {
          state.idle?.trigger?.('护胸防御')
          state.bubble?.say('defense', { ms: 3200 })
          toast('护住胸口：恬……恬不知耻！')
        }
        return
      }
      // 一互动就让待机动作让位：不是暂停，而是彻底停掉当前动作（撤表情/姿势/固定参数），
      // 否则会出现「黑脸 + 打瞌睡半睁眼」这种叠出来的怪状态。
      // 只认真正的接触（按下 / 抚摸 / 拖拽），hover 不算 —— 鼠标停在角色身上不该冻结待机。
      if (ev.type === 'down' || ev.type === 'pet' || ev.type === 'dragStart') state.idle?.reset?.(2600)
      // 摸到别处就把「摸胯神态」收掉，不然半睁眼会挂到下一个动作上
      if (name !== '胯' && (ev.type === 'down' || ev.type === 'tap' || (ev.type === 'pet' && ev.step === 1))) {
        clearTimeout(state.crotchFaceHold)
        crotchFace(false)
      }
      // 摸胸：右手盖到胸口（举手姿势），表情走分区反应（屑屑眼）
      if (name === '胸' && ev.type === 'pet' && ev.step === 1) {
        state.poses?.set('举手', 320)
        holdPoseGuard(5200)       // 护住期间别被自动收手打断
        clearTimeout(state.chestHold)
        state.chestHold = setTimeout(() => { state.poses?.release(420) }, 3600)
      }
      // 摸胯：黑脸 + 脸红 + 护住（举手手型）+ 右转头低头微缩，气泡说「变态」那套
      // 以前用「护胯」预设，但它的头/身体偏移在物理链上复现不出来（设置里也删掉了）；
      // 现在只用官方「举手」手型，神态交给 crotchFace。
      if (name === '胯' && ev.type === 'pet' && ev.step === 1) {
        state.poses?.set('举手', 340)
        holdPoseGuard(6200)
        // 差分决定这一下是「黑脸威胁」「脸红偏头」还是「嫌弃 / 委屈」；
        // 没差分才回落到固定的半睁眼神态（crotchFace）
        if (!runVariant('胯', 'pet', { rxRegion: { name: '胯' }, ms: 4200 })) {
          state.reactions.apply({ name: '胯' }, 'pet')
          state.bubble?.say('crotch', { ms: 4200 })
          crotchFace(true)
          clearTimeout(state.crotchFaceHold)
          state.crotchFaceHold = setTimeout(() => crotchFace(false), 4200)
        }
        clearTimeout(state.crotchHold)
        state.crotchHold = setTimeout(() => { state.poses?.release(420) }, 4200)
      }
      // 点额头 = 模型三态循环：常态 → 爱心眼 → 黑框眼镜
      if (ev.type === 'tap' && name === '额头') {
        const m = cycleMode()
        toast(`表情：${m}`)
        // 三态照旧循环，差分只换「点的时候说什么」
        runVariant('额头', 'tap')
      // 点手 = 竖手指（抬起/放下），不再走表情反应；摸手还是 ＞＜ + 脸红
      // 点长裙 = 换回短裙（长裙把腿挡住了，这块不该再算腿）
      } else if (ev.type === 'tap' && name === '长裙') {
        if (state.layers?.hasExpression?.('裙子切换')) state.layers.removeExpression('裙子切换')
        scheduleZoneRefresh(200)   // 立刻重铺：腿热区要马上回来
        toast('换回短裙')
        if (!runVariant('长裙', 'tap', { ms: 2200 })) state.bubble?.say('longSkirtTap', { ms: 2200 })
        state.recomputePass?.()
      // 点哪只手就切哪只手：热区名是**画面左右**，而用户说的左右是**角色左右**（镜像）。
      //   画面右 = 角色左手 = 食指手（竖手指那套图）
      //   画面左 = 角色右手 = 抚胸手（举手那套图，会盖住胸口 → 胸热区随之停用）
      } else if (ev.type === 'tap' && isHand) {
        const side = name === '右手' ? 'left' : 'right'
        const on = state.poses?.toggleHand?.(side) ?? ''
        toast(side === 'left' ? (on ? '左手：竖起食指' : '左手：放下') : (on ? '右手：抚胸' : '右手：放下'))
        syncChestZone()
        stretchHandZones()
        // 手型切换照旧，差分只换「切的时候说什么」
        if (!runVariant(name, 'tap')) state.bubble?.say('hand', { ms: 2400 })
      } else if (ev.type === 'tap' && name && name !== '脸') {
        // 先抽差分：命中就按这套的情绪 / 台词 / 嘴形演出，没命中才走旧的固定反应
        if (!runVariant(name, 'tap', { rxRegion: ev.region })) {
          state.reactions.apply(ev.region, 'tap')
          const k = TOUCH_PHRASE[name]?.tap
          if (k) state.bubble?.say(k, { ms: 2400 })
        }
      }
      // 在长裙上滑动 = 提裙摆转个身（左右轻转）+ 亲密台词
      if (name === '长裙' && ev.type === 'dragEnd') {
        skirtSway()
        if (!runVariant('长裙', 'dragEnd', { ms: 3600 })) state.bubble?.say('longSkirt', { ms: 3600 })
      }
      // 胯在上面单独处理（要抢在「一互动就 reset」之前上举手 + 差分台词），这里跳过避免抽两次
      if (ev.type === 'pet' && name && name !== '脸' && name !== '胯' && ev.step === 1) {
        // 额头抚摸回退成「头」之后，反应表也要按「头」查，否则 ＞＜ / 脸红 出不来
        const rxRegion = ev.region?.name && ev.region.name !== name ? { ...ev.region, name } : ev.region
        // 脚 / 腰 = 被挠痒：痒痒的动作与差分无关，先起
        if (name === '脚' || name === '腰') state.tickle?.start()
        const v = runVariant(name, 'pet', { rxRegion })
        if (!v) {
          state.reactions.apply(rxRegion, 'pet')
          if (name === '脚' || name === '腰') {
            state.bubble?.say('tickle', { ms: 2600 })
          } else {
            const k = TOUCH_PHRASE[name]?.pet
            if (k) state.bubble?.say(k, { ms: 2600 })
          }
        }
        // 差分没写嘴形时回落到分区默认：表情包只改眼/脸，嘴由这层驱动
        if (!v?.mouth) {
          const mood = REGION_MOUTH[name]
          if (mood) state.mouth?.setMood(mood, mood.ms)
        }
      }
      // 被点/被摸的时候，耳朵跟着扑棱一下（平时它自己每 6~13 秒也会扑棱）
      if (name === '头' && (ev.type === 'tap' || (ev.type === 'pet' && ev.step === 1))) {
        state.life?.flap(Math.random() < 0.5 ? 'L' : 'R', 1)
      }
      // 只有头会「跟着手摆」：按下起记位移，滑动按 50% 转成角度；其它部位不再弹
      if (name === '头') {
        if (ev.type === 'down' || (ev.type === 'pet' && !state.petArmed)) {
          state.petArmed = true
          state.lastClient = null
          state.petSway?.start('头')
        } else if (ev.type === 'up' || ev.type === 'petEnd') {
          state.petArmed = false
          state.petSway?.release()
        }
      }
      // 捏脸：按住脸拖 → 鼓脸
      // 捏脸：左右各一半热区，按住哪边捏哪边（方向不再参与判定）
      if (name === '左脸' || name === '右脸') {
        if (ev.type === 'down') {
          state.facePinch?.grab(name === '右脸' ? 'R' : 'L')
          // 正脸：视线回中，鼓脸才看得见
          state.gaze?.setTarget?.(0, 0)
          // 捏脸差分：半睁眼嫌你 / 要漏气了 / 真的生气 / 小声撒娇
          if (!runVariant(name, 'down', { ms: 2000 })) {
            pinchExpressions(true)
            state.bubble?.say('pinch', { ms: 2000 })
          }
        } else if (ev.type === 'dragMove') {
          // ev.dx/dy 是模型坐标，换成客户端像素再交给捏脸层（maxPull 是按像素定的）
          // 镜像期间 scale.x 是负的，取绝对值，不然拖动方向会反
          const k = Math.abs(state.stage?.model?.scale?.x || 1)
          state.facePinch?.move((ev.dx || 0) * k, (ev.dy || 0) * k)
        } else if (ev.type === 'up') {
          state.facePinch?.release()
          pinchExpressions(false)
          // 捏脸差分上的表情随松手一起撤，别挂到下一个动作（source 'variant' 不归 pinch 管）
          clearTimeout(state.variantExprHold)
          try { state.layers?.removeSource('variant') } catch {}
        }
      }
      // 手在哪的偏摆已废弃：现在由 pointermove 的位移驱动（见上方 petArmed）
    },
  })
  state.regionInput.attach($('#stage'))
  startFaceRegionTracking(names)
}

/** 通用「按住拖动 = 搬窗口」绑定 */
/**
 * 拖动位置合帧器：把「最新光标位置」独立调度发给主进程，**不等渲染帧**。
 *
 * 以前挂在 requestAnimationFrame 上：渲染掉到 30fps 时窗口就跟着一顿一顿，
 * 因为位置消息被渲染帧的尾巴拖着。现在
 *   - 第一个事件立即发（跟手延迟 = IPC 时间，不再叠一帧渲染）；
 *   - 之后最多 8ms 一拍，且永远只发**最新**坐标（中间值直接丢，不积压）；
 *   - pointermove 再密也不会堆成几百次 setPosition。
 */
const MOVE_MIN_GAP = 8
function createMoveQueue(isActive) {
  let px = null
  let py = null
  let timer = 0
  let last = 0
  const pump = () => {
    timer = 0
    if (px === null) return
    const x = px
    const y = py
    px = null
    py = null
    if (!isActive()) return
    last = performance.now()
    shell.dragMove?.(x, y)
  }
  return {
    queue(x, y) {
      px = x
      py = y
      if (timer) return
      const wait = Math.max(0, MOVE_MIN_GAP - (performance.now() - last))
      if (wait === 0) pump()
      else timer = setTimeout(pump, wait)
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = 0 }
      pump()
    },
  }
}

function dragWindow(el, { canStart, ignore, button = 0, onStart, onMove, onEnd } = {}) {
  let lastX = 0
  let lastY = 0
  let dragging = false
  const move = createMoveQueue(() => dragging)
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== button) return
    if (ignore?.(e)) return
    if (canStart && !canStart(e)) return
    dragging = true
    state.windowDragging = true
    lastX = e.screenX
    lastY = e.screenY
    if (state.dragSamples) state.dragSamples = [{ t: Math.round(performance.now()), ev: 'down' }]
    el.classList.add('dragging')
    // 和中间键走同一套：主进程按「全局光标 − 按下时的光标」搬窗口。
    // 以前是每次 pointermove 都发 win:move（主进程 getPosition + setPosition 各一次），
    // 高频指针流下就是几百次 IPC/秒 + 取整误差回读，表现是拖动一卡一卡还带漂移。
    shell.dragBegin?.(e.screenX, e.screenY)
    onStart?.()
    try { el.setPointerCapture(e.pointerId) } catch {}
  })
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.screenX - lastX
    const dy = e.screenY - lastY
    if (!dx && !dy) return
    lastX = e.screenX
    lastY = e.screenY
    // 抓取向量：按事件时间算实时速度（px/s），拖拽物理直接吃这份，而不是等窗口坐标的帧间差分
    const now = performance.now()
    const dtEv = Math.max(0.004, (now - (state.dragVec?.t || now - 16)) / 1000)
    const cap = 6000
    state.dragVec = { vx: Math.max(-cap, Math.min(cap, dx / dtEv)), vy: Math.max(-cap, Math.min(cap, dy / dtEv)), t: now }
    // 窗口由主进程按「按下时的抓取偏移」跟随：这里报屏幕坐标，按帧合并后一帧一挪，
    // 不再等主进程 16ms 定时器（Windows 上它会退化成 ~30ms 一拍）
    move.queue(e.screenX, e.screenY)
    onMove?.(dx, dy)
    // 拖动采样：排查「一卡一卡」用。记录每个 pointermove 的增量与到达时间
    if (state.dragSamples) {
      state.dragSamples.push({ t: Math.round(now), dx, dy, sx: e.screenX, sy: e.screenY })
      if (state.dragSamples.length > 600) state.dragSamples.shift()
    }
  })
  const end = (e) => {
    if (!dragging) return
    // 先把最后一帧的位置补发掉，再结束拖动，避免松手位置比光标差一帧
    move.flush()
    dragging = false
    state.windowDragging = false
    state.dragVec = null
    el.classList.remove('dragging')
    shell.dragEnd?.()
    onEnd?.()
    try { el.releasePointerCapture(e.pointerId) } catch {}
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  return el
}

// ---------- 透明处穿透：只让「角色轮廓」接收鼠标 ----------
// 窗口是矩形，透明区本来也吃鼠标：停在空白处，后面的桌面/窗口点不到；
// 空白处按下还能把整块看不见的窗口拖走 —— 这就是「隐藏的窗口边缘」。
// 做法：把当前帧渲染成缩略 alpha 掩码，指针不在角色身上就让点击穿过去。
const MASK_SCALE = 4
// 掩码几乎全空 = 没渲染出来，这种情况下永远保持可点，别把窗口弄成点不动的死窗
const MASK_MIN_COVERAGE = 0.004

const MASK_TTL = 700
function refreshMask(force = false) {
  const now = performance.now()
  if (!force) {
    if (state.mask && now - state.maskAt < MASK_TTL) return state.mask
    // 不在这里重画：挂个待办，等这一帧画完之后直接读回来（见 bindPassThrough 里的 afterRender）。
    // 事件回调里插一次渲染会打乱帧节奏，窗口正在拖动时尤其明显（虚影/闪烁）。
    state.maskPending = true
    return state.mask
  }
  const m = perf.time('mask', () => state.stage?.alphaMask?.(MASK_SCALE, (k, ms) => perf.mark(`m.${k}`, ms)))
  if (m) { state.mask = m; state.maskAt = now; state.maskPending = false }
  return state.mask
}

/**
 * 掩码作废（改尺寸 / 拖动结束 / 切模型）。
 * 以前这里直接 refreshMask(true) —— 当场强制渲染一帧再读回整张画布。
 * 缩放窗口时这一下正好叠在 resize 上，是「缩放卡顿」的主因。
 * 现在只标脏：下一帧本来就画，画完由 afterRender 顺手读回（读回区域也跟着重算）。
 */
function dirtyMask() {
  state.stage?.invalidateMask?.()
  state.maskAt = 0
  state.maskPending = true
}

/** 客户端坐标是否落在角色身上；拿不到掩码一律当作「在」——宁可点得到 */
function bodyAt(x, y) {
  const m = state.mask
  if (!m || m.coverage < MASK_MIN_COVERAGE) return true
  const r = state.stage.canvas.getBoundingClientRect()
  const sx = (x - r.left) / Math.max(1, r.width)
  const sy = (y - r.top) / Math.max(1, r.height)
  if (sx < 0 || sy < 0 || sx > 1 || sy > 1) return false
  const cx = Math.min(m.w - 1, Math.floor(sx * m.w))
  const cy = Math.min(m.h - 1, Math.floor(sy * m.h))
  // 一个小膨胀：边缘抖一两格不算离开角色，免得边沿闪烁
  for (let dy = -1; dy <= 1; dy++) {
    const ny = cy + dy
    if (ny < 0 || ny >= m.h) continue
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx
      if (nx < 0 || nx >= m.w) continue
      if (m.data[ny * m.w + nx] > 8) return true
    }
  }
  return false
}

// ---------- 透明处穿透 ----------
// 判据三条：
//   1. 指针落在工具条 / 「恢复鼠标」浮标这些 HTML 控件上 → 一律接收（否则开了穿透连按钮都点不到）
//   2. 手动穿透模式 → 角色也将鼠标穿透（UI 之外一律忽略）
//   3. 常态 → 按住期间不穿透，其余看角色轮廓掩码
// 注意：窗口尺寸不再手拖，所以没有「轮廓把手」这一类必须接收的例外了。
function createPassThrough() {
  let pending = null
  let queued = false
  let timer = 0

  /** 当前指针位置该不该穿透；没坐标时给 null（不改变现状） */
  function decide() {
    if (!pending || !state.settings) return null
    // 显示窗口边框时整窗接收鼠标：边框把手要能拖，不能把鼠标漏给桌面
    if (state.borderOn) return false
    const el = document.elementFromPoint(pending.x, pending.y)
    if (el && el.tagName !== 'CANVAS') return false
    if (state.settings.clickThrough) return true
    return !state.pointerDown && !bodyAt(pending.x, pending.y)
  }

  function applyNow() {
    queued = false
    const want = decide()
    if (want == null || want === state.ignoring) return
    state.ignoring = want
    shell.setPassThrough(want)
  }

  return {
    track(x, y) {
      pending = { x, y }
      refreshMask()
      if (queued) return
      queued = true
      // 用 16ms 定时而不是 rAF：窗口被完全遮挡时 rAF 会停，判定就永远不更新
      clearTimeout(timer)
      timer = setTimeout(() => perf.time('pass', applyNow), 16)
    },
    /** 勾选/取消穿透、松手之后立刻按当前指针重算，不必等鼠标再晃一下 */
    recompute() { if (pending) perf.time('pass', applyNow) },
    /** 只算不应用（验证/调试用）：给定坐标下的穿透判定结果 */
    decideAt(x, y) {
      const keep = pending
      pending = { x, y }
      const want = decide()
      pending = keep
      return want
    },
  }
}

/**
 * 按住期间一概不穿透：滑出轮廓那一刻若忽略鼠标，pointerup 会丢，抚摸/拖动就卡在按下态。
 */
function bindPointerHeld() {
  const down = () => { state.pointerDown = true }
  const up = () => { state.pointerDown = false }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  window.addEventListener('blur', up)
}

/** 轮廓掩码读回：挂在「每帧画完」之后，只读像素、不额外渲染；拖窗口期间先攒着 */
function startMaskCapture() {
  state.stage?.afterRender?.(() => {
    if (!state.maskPending || state.windowDragging) return
    state.maskPending = false
    const t0 = performance.now()
    const phases = {}
    const m = perf.time('mask', () => state.stage.captureMask?.(MASK_SCALE, (k, ms) => { phases[k] = ms; perf.mark(`m.${k}`, ms) }))
    if (m) {
      state.mask = m
      state.maskAt = performance.now()
      // 诊断日志：卡顿排查用（拖影/周期性掉帧先看这张表）
      state.maskLog = state.maskLog || []
      state.maskLog.push({ t: Math.round(t0), ms: +(performance.now() - t0).toFixed(1), ...phases })
      if (state.maskLog.length > 80) state.maskLog.shift()
    }
  })
}

function bindPassThrough() {
  const pass = createPassThrough()
  state.passThrough = pass // 调试/验证入口（__pass.passAt）
  state.recomputePass = () => pass.recompute()
  bindPointerHeld()
  window.addEventListener('pointermove', (e) => pass.track(e.clientX, e.clientY))
  // 松手时指针可能已经在轮廓外，重算一次才不会停在「按下态不穿透」
  window.addEventListener('pointerup', () => pass.recompute())
  window.addEventListener('resize', dirtyMask)
  startMaskCapture()
  // 启动时拿一张准的：此刻还没有「上一帧」，读的是整张（只有这一次）
  refreshMask(true)
}

// ---------- 穿透模式 ----------
// 手动穿透时角色区完全不可点（连右键都进不来），所以必须留一个「鼠标也能点到」的退路：
// 面板/工具条本身仍然接收鼠标，再加一个常驻浮标一键恢复。
function setClickThrough(on) {
  applyPassState(on) // 单向落到界面，不触发设置回写（广播那条路自己会进来）
  shell.set({ clickThrough: !!on })
  if (on) toast('穿透已开：角色不可点，点下方「恢复鼠标」或按 Ctrl+Alt+L', 4000)
}

function showPassHint() {
  let el = $('#pass-hint')
  if (!el) {
    el = document.createElement('div')
    el.id = 'pass-hint'
    el.innerHTML = '<span>穿透中</span><button id="pass-restore" type="button">恢复鼠标</button>'
    el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);' +
      'display:flex;gap:8px;align-items:center;padding:7px 10px 7px 14px;border-radius:999px;' +
      'background:rgba(16,20,34,.94);border:1px solid rgba(120,150,255,.45);color:#dfe6ff;' +
      'font:12px/1 system-ui,sans-serif;z-index:9999;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.45)'
    const btn = el.querySelector('#pass-restore')
    btn.style.cssText = 'all:unset;cursor:pointer;padding:5px 10px;border-radius:999px;' +
      'background:#5a7cff;color:#fff;font:12px/1 system-ui,sans-serif'
    btn.onclick = () => setClickThrough(false)
    document.body.appendChild(el)
  }
  el.style.display = 'flex'
}

function hidePassHint() {
  const el = $('#pass-hint')
  if (el) el.style.display = 'none'
}

// ---------- 窗口跟随角色（尺寸 = 模型画布 × 角色大小）----------
// 视口固定 contain、zoom 恒为 1：窗口多大，角色就多大 —— 「角色大小与窗口大小比例绑定」
// 在数值上的含义是窗口尺寸由模型画布推导，而不是反过来测角色包围盒（后者会形成正反馈）。
const FIT_BASE_W = 540      // zoom = 1 时角色的屏幕宽度（窗口再留出气泡余量）
// 动作抢头部角度的分档（度，ParamAngle* 的量程是 ±30）：
// 低于 LO 完全不让位，高于 HI 完全交给动作，中间线性过渡
const HEAD_YIELD_LO = 4
const HEAD_YIELD_HI = 12
const FIT_PAD_X = 0.12      // 左右各 6%：够气泡挂在头侧，又不会把角色缩太小
// 上下留白：设置里可调（0–18%）。默认 2% —— 边框刚好包住角色，不再上下各空 9%
const FIT_PAD_Y_DEFAULT = 0.02
const padY = () => {
  const v = Number(state.settings?.padY)
  return Math.max(0, Math.min(0.2, Number.isFinite(v) ? v : FIT_PAD_Y_DEFAULT))
}

function fitSize() {
  const ms = state.stage?.modelSize?.()
  if (!ms?.width || !ms?.height) return null
  const k = (FIT_BASE_W / ms.width) * (Number(state.settings?.zoom) || 1)
  return {
    w: Math.round(ms.width * k * (1 + FIT_PAD_X)),
    h: Math.round(ms.height * k * (1 + padY())),
  }
}

let fitTimer = 0
// 上一次已经下发过的窗口尺寸：尺寸没变就不再发 IPC（以前每 100ms 发一次，主进程每发一次都会把窗口挪 1px）
let lastFitSize = { w: 0, h: 0 }
const BODY_BANDS = ['头', '胸', '腰', '裙摆', '腿', '脚']

/**
 * 身体中心（模型坐标）：只取静态的躯干/四肢热区包围盒，**不含尾巴和手**——
 * 尾巴和头发一直在摆，用真实轮廓去量会把角色越推越偏，而且每次浮动都不一样。
 */
function bodyAnchor() {
  const rs = (state.store?.all || []).filter((r) => BODY_BANDS.includes(r.name) && r.points?.length)
  if (!rs.length) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const r of rs) {
    for (const [x, y] of r.points) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }
}

/**
 * 居中的归一化偏移——**纯几何算，不做任何运行时测量**。
 *
 * 视口是 contain：scale = min(W/mw, H/mh) × 0.95。窗口的长宽比被 FIT_PAD 固定，
 * 所以永远是「高度受限」那一支，scale/H = 0.95/mh，于是：
 *   offsetY = -2 × (身体中心y/mh − 0.5) × 0.95
 *   offsetX = -2 × (身体中心x/mw − 0.5) × 0.95 × (1+FIT_PAD_Y)/(1+FIT_PAD_X)
 * 全是模型常量，和窗口大小、缩放、测量时机都无关 —— 不会出现「切一次尺寸就偏一次」。
 */
function centerOffsets() {
  const b = bodyAnchor()
  const ms = state.stage?.modelSize?.()
  if (!b || !ms?.width || !ms?.height) return { x: 0, y: 0 }
  const fx = b.x / ms.width - 0.5
  const fy = b.y / ms.height - 0.5
  const k = 2 * 0.95 // 2 × 视口 margin
  // 夹板：x 放宽一点，y 必须放宽更多 ——
  // Q 版体型的身体中心跑到画布上部，按公式要 ~0.51 的半窗偏移才回得正中；
  // 原来统一夹在 ±0.4，等于把「该挪」的一半给截了，表现就是换成小体型后不居中。
  const clampX = (n) => Math.max(-0.6, Math.min(0.6, n))
  const clampY = (n) => Math.max(-0.9, Math.min(0.9, n))
  return {
    x: clampX((-k * fx * (1 + padY())) / (1 + FIT_PAD_X)),
    y: clampY(-k * fy),
  }
}

// ---------- 头部贴合气泡：体型变小，角色按比例放大回去 ----------
// 窗口尺寸是从**画布**推的（FIT_BASE_W），画布不随体型变；而体型参数（Clothes2）一拉，
// 角色网格整片缩小，于是角色在窗口里跟着变小、头离右上角的气泡越来越远。
// 实测（700×1280 窗口）：标准体型头高 1193、Q 版头高 1006，但头到脚从 6511 缩到 3845 ——
// 头只小 16%，整个人小了 41%。所以基准必须是**头**（气泡挂头），不是全身。
//
//   放大倍数  z = 标准体型头高 / 当前头高
//   头顶钉在  HEAD_TOP_FRAC（气泡正下方）
//   头心钉在  HEAD_CX_FRAC（略偏右，给气泡让位）
//
// 推导（视口 contain、窗口宽高比被 FIT_PAD 固定 → 永远「高度受限」）：
//   s = 0.95·k·(1+padY)·z，  s·mh/H = 0.95·z，  s·mw/W = 0.95·(1+padY)·z/(1+padX)
//   头顶屏幕比例 fTop = 0.5 + offY/2 + (top/mh − 0.5)·0.95·z   = HEAD_TOP_FRAC
//   头心屏幕比例 fCx  = 0.5 + offX/2 + (cx/mw − 0.5)·s·mw/W    = HEAD_CX_FRAC
// 两式分别解 offY / offX —— 全是模型常量，和窗口尺寸、用户缩放无关，不会来回抖。
const HEAD_TOP_FRAC = 0.098    // 头顶在窗口高度里的目标位置（实测标准体型：气泡下沿刚好压住）
const HEAD_CX_FRAC = 0.518     // 头部中心在窗口宽度里的目标位置
// 放大基准：
//   'span' = 全身轮廓（头到脚的高度对齐标准体型 → 头顶贴合气泡、脚底位置也一致，默认）
//   'head' = 只锁头部尺寸（头一样大，身体按 Q 版比例变短；`Q 版整体会显得矮`）
const FIT_SCALE_MODE = 'span'
// 还没有基准时的兜底（标准体型实测值，按画布高归一）：头高 15.5%、头到脚 84.6%
const HEAD_FRAC_FALLBACK = 0.155
const SPAN_FRAC_FALLBACK = 0.846
const Z_MIN = 0.8
const Z_MAX = 2.6

const fitRefKey = () => `live2d-stage/fitref/v1/${state.caps?.model?.name || 'model'}`

/** 标准体型（Clothes2 = 0）的头高 / 头到脚高度基准：存 localStorage，换模型各存各的 */
function loadFitRef() {
  try { return JSON.parse(localStorage.getItem(fitRefKey()) || 'null') } catch { return null }
}
function saveFitRef(ref) {
  try { localStorage.setItem(fitRefKey(), JSON.stringify({ ...ref, at: Date.now() })) } catch {}
}

/**
 * 居中/缩放用的测量缓存键：只有体型、裙装、模型换了才该重算。
 * 热区每隔一阵会被重新铺一次（按网格签名），像素级差异会让「头框」变几像素，
 * 跟着它重算偏移/缩放 = 角色自己在那抖 —— 这就是「偶发身体微小抖动」的来源之一。
 */
function fitMeasureKey() {
  return `${Math.round((state.bodyShape ?? 0) * 100)}|${skirtIsLong() ? 1 : 0}|${state.caps?.model?.name || ''}`
}

/** 当前头部包围盒（模型坐标）——只读「头」热区；按体型/裙装缓存 */
function headBox() {
  const key = fitMeasureKey()
  const c = state.fitBoxCache
  if (c?.key === key && c.head) return c.head
  const r = state.store?.all?.find((x) => x.name === '头')
  if (!r?.points?.length) return null
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const [x, y] of r.points) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  const head = { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2 }
  state.fitBoxCache = { key, head, span: c?.key === key ? c.span : null }
  return head
}

/** 当前头到脚的包围盒（模型坐标）——顶部取「头」热区，底部取「脚」热区；同样缓存 */
function bodySpan() {
  const key = fitMeasureKey()
  const c = state.fitBoxCache
  if (c?.key === key && c.span) return c.span
  const head = headBox()
  const foot = state.store?.all?.find((x) => x.name === '脚')
  if (!head || !foot?.points?.length) return null
  let y1 = -Infinity
  for (const [, y] of foot.points) if (y > y1) y1 = y
  const span = { top: head.y0, bottom: y1, h: y1 - head.y0 }
  state.fitBoxCache = { key, head, span }
  return span
}

/** 体型拉回标准值（0）时顺手把「标准头高 / 标准全身高」记下来，基准会自愈 */
function noteFitRef() {
  if ((state.bodyShape ?? 0) > 0.001) return
  const head = headBox()
  const span = bodySpan()
  if (!head || head.h < 60 || !span || span.h < 80) return
  if (Math.abs(head.h - (state.fitRefHead || 0)) < 1 && Math.abs(span.h - (state.fitRefSpan || 0)) < 1) return
  state.fitRefHead = head.h
  state.fitRefSpan = span.h
  saveFitRef({ head: head.h, span: span.h })
}

/**
 * 算出「放大倍数 + 位置」：
 *   zoom 给视口，x/y 是归一化偏移。拿不到头/基准时退回身体中心居中（centerOffsets）。
 */
function headFit() {
  const ms = state.stage?.modelSize?.()
  const head = headBox()
  const span = bodySpan()
  if (!ms?.width || !ms?.height || !head || !head.h || !span) {
    return { zoom: 1, ...centerOffsets() }
  }
  const mw = ms.width, mh = ms.height
  // 基准（标准体型 Clothes2 = 0）：优先用存档，读不到按画布比例兜底
  const refHead = state.fitRefHead || mh * HEAD_FRAC_FALLBACK
  const refSpan = state.fitRefSpan || mh * SPAN_FRAC_FALLBACK
  // 放大倍数：让「整个角色」在屏幕上和标准体型一样高（FIT_SCALE_MODE='head' 时只锁头）
  let z = FIT_SCALE_MODE === 'head' ? refHead / head.h : refSpan / span.h
  z = Math.max(Z_MIN, Math.min(Z_MAX, z))
  // 兜底：别为了对齐头把脚顶出窗口。脚底比例随 z 线性长（头顶固定），超过 98.5% 就回退 z
  const A = (head.y0 / mh - 0.5) * 0.95
  const B = (span.bottom / mh - 0.5) * 0.95
  if (B > A) {
    const zMax = (0.985 - HEAD_TOP_FRAC) / (B - A)
    if (zMax > 0.1) z = Math.min(z, Math.max(1, zMax))
  }
  const sMwW = (0.95 * (1 + padY()) * z) / (1 + FIT_PAD_X) // s·mw/W
  const clampX = (n) => Math.max(-0.8, Math.min(0.8, n))
  const clampY = (n) => Math.max(-1.2, Math.min(1.2, n))
  // 量化到 0.001：测量噪声不该变成视口里的亚像素抖动
  const q = (v) => Math.round(v * 1000) / 1000
  return {
    zoom: q(z),
    x: q(clampX(2 * (HEAD_CX_FRAC - 0.5 - (head.cx / mw - 0.5) * sMwW))),
    // 头顶固定：s·mh/H = 0.95·z
    y: q(clampY(2 * (HEAD_TOP_FRAC - 0.5 - (head.y0 / mh - 0.5) * 0.95 * z))),
  }
}

/**
 * 体型 / 换装换了网格 → 身体中心跟着变，居中偏移必须重算。
 * 以前只在窗口尺寸变化时算一次（applyFit），体型一变中心就停在旧位置。
 */
let recenterTimer = 0
function scheduleRecenter() {
  // 启动阶段不用管：main() 里 bootRegions 之后本来就会 applyFit(true) 算一次
  if (!state.bootReady) return
  clearTimeout(recenterTimer)
  recenterTimer = setTimeout(() => {
    recenterTimer = 0
    applyFit(true)
  }, 140)
}

/** 重算并下发窗口尺寸（连发合并 70ms，滚轮狂滚也不会打爆往主进程的 IPC） */
function applyFit(now = false) {
  const send = () => {
    fitTimer = 0
    // 尺寸在发的时候再算一次：70ms 的防抖里 zoom 可能又变了
    const size = fitSize()
    if (!size) return
    // zoom 不再是恒 1：体型变小 → 按头高反算放大倍数，让头始终挂在气泡下面
    const f = headFit()
    // 滚轮缩放：按「矩形绕光标缩放」的语义下发。
    // 用户给的等价例子：矩形 (0,0)-(3,4)、光标 (1,1)、放大 2 倍 → 矩形变成 (-1,-1)-(5,7)。
    // 主进程按 k 直接算新 bounds（宽高×k，左上角 = 光标 − (光标−旧左上角)×k），
    // 内容跟着窗口等比放大，所以「光标下那个点不动」是这条规则的**结果**，不是另算的补位。
    let rect = null
    const a = state.zoomAnchor
    if (a && a.k > 0) rect = { sx: a.sx, sy: a.sy, k: a.k }
    state.zoomAnchor = null
    state.viewport?.set({ zoom: f.zoom, offsetX: f.x, offsetY: f.y })
    if (rect) {
      // 主进程按自己的旧 bounds 算新尺寸，可能和 fitSize 差 1px；下次常规 fit 再校正
      lastFitSize = { w: 0, h: 0 }
      shell.fit?.(size.w, size.h, { rect })
    } else if (size.w !== lastFitSize.w || size.h !== lastFitSize.h) {
      lastFitSize = { w: size.w, h: size.h }
      shell.fit?.(size.w, size.h)
    }
    state.bubble?.reposition()
    // 尾巴气泡也贴着模型走：缩放/体型一变，尾尖的屏幕位置就变了
    placeTailRestore($('#tail-restore'))
  }
  clearTimeout(fitTimer)
  if (now) { send(); return }
  fitTimer = setTimeout(send, 70)
}

// ---------- 窗口边框 / 等比缩放 ----------
// 窗口、角色、气泡共用同一比例：窗口高 = 模型高 × (540/宽) × (1+PAD) × zoom，
// 所以「当前 zoom」可以直接由窗口高度反推。拖边框改的是窗口尺寸，三者一起变。
// 气泡比例除以基准 0.8，让默认大小和旧版视觉一致。
const UI_BASE_ZOOM = 0.8

function refWindowHeight() {
  const ms = state.stage?.modelSize?.()
  if (!ms?.width || !ms?.height) return null
  return ms.height * (FIT_BASE_W / ms.width) * (1 + padY())
}
function zoomFromWindow() {
  const ref = refWindowHeight()
  if (!ref) return Number(state.settings?.zoom) || 1
  return window.innerHeight / ref
}
function bubbleScale() {
  // ×1.06：比旧版大一号（用户反馈气泡框偏小）
  return Math.max(0.4, Math.min(2.5, (zoomFromWindow() / UI_BASE_ZOOM) * 1.06))
}

function applyBorder(on) {
  state.borderOn = !!on
  $('#frame')?.classList.toggle('hidden', !on)
  if (on) {
    // 边框要能接鼠标：这期间不做「透明处穿透」
    state.ignoring = false
    shell.setPassThrough?.(false)
  }
  state.recomputePass?.()
}

function endScale() {
  if (!state.scaleEdge) return
  state.scaleEdge = null
  shell.scaleEnd?.()
  const z = Math.max(0.2, Math.min(3, Math.round(zoomFromWindow() * 1000) / 1000))
  if (Math.abs(z - (Number(state.settings?.zoom) || 1)) > 0.002) shell.set?.({ zoom: z })
}

function bindFrame() {
  const f = $('#frame')
  if (!f) return
  const edges = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']
  f.innerHTML = edges.map((e) => `<div class="fh ${e}" data-edge="${e}"></div>`).join('')
  for (const h of f.querySelectorAll('.fh')) {
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      state.scaleEdge = h.dataset.edge
      shell.scaleBegin?.(state.scaleEdge)
      try { h.setPointerCapture(e.pointerId) } catch {}
    })
  }
  window.addEventListener('pointerup', endScale)
  window.addEventListener('pointercancel', endScale)
  window.addEventListener('blur', endScale)
  window.addEventListener('resize', () => {
    state.bubble?.setScale(bubbleScale())
    state.bubble?.reposition()
  })
}

function bindWindowDrag() {
  const stage = $('#stage')
  // 左键只做互动（点/摸/捏脸/拖手势），**不再搬窗口**：
  // 以前按下即拖，按到没被热区盖住的身上一点点就整块窗口跟着走，
  // 观感就是「左键变成拖拽、互动没了」。搬窗口现在只认中键和右键按住。
  dragWindow(stage, {
    button: 2,
    canStart: (e) => bodyAt(e.clientX, e.clientY),
    onStart: () => { state.rightDragAt = 0; state.rightDragMoved = 0 },
    onMove: (dx, dy) => {
      state.rightDragMoved += Math.abs(dx) + Math.abs(dy)
      if (state.rightDragMoved > 4) state.rightDragAt = performance.now()
    },
    onEnd: () => { if (state.rightDragAt) state.rightDragAt = performance.now() },
  })
  bindMiddleDrag(stage)
  // 右键按住不放 = 搬窗口。浏览器在 pointerup 之后还会补一个 contextmenu，
  // 不拦住的话「拖完松手」会顺手弹出工具栏 —— 拖过就不弹。
  stage.addEventListener('contextmenu', (e) => {
    if (state.rightDragAt && performance.now() - state.rightDragAt < 500) e.preventDefault()
  }, true)
  // 兜底：页面卸载/失焦时收不到 pointerup，主进程的拖动定时器必须显式停掉
  const endAllDrag = () => {
    state.middleDragging = false
    state.windowDragging = false
    state.dragVec = null
    shell.dragEnd()
  }
  window.addEventListener('pagehide', endAllDrag)
  window.addEventListener('blur', endAllDrag)
}

/**
 * 中键拖动 = 搬窗口，**和右键拖动共用同一套拖拽物理**。
 *
 * 以前中键是「纯位移」：不喂抓取向量，身体不会甩，头发/裙摆也不会被带动。
 * 现在两条路径都走 `updateMotion` 的弹簧-阻尼（`ParamBodyAngleRX/RY`），
 * 区别只剩触发方式：右键按住角色、中键按任意处（左键是互动，不搬窗）。
 * 主进程仍按全局光标锚点搬窗口，不累积漂移。
 */
function bindMiddleDrag(stage) {
  const cap = 6000
  let lastX = 0
  let lastY = 0
  const move = createMoveQueue(() => state.middleDragging)
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 1) return
    e.preventDefault()
    hideTools()
    state.middleDragging = true
    // 复用右键那套：windowDragging 让弹簧用「拖动中」的高阻尼，dragVec 给实时速度
    state.windowDragging = true
    state.dragVec = null
    lastX = e.screenX
    lastY = e.screenY
    shell.dragBegin(e.screenX, e.screenY)
    try { stage.setPointerCapture(e.pointerId) } catch {}
  })
  // 抓取向量：pointermove 的实时速度，比窗口坐标的帧间差分更快、更准
  stage.addEventListener('pointermove', (e) => {
    if (!state.middleDragging) return
    const dx = e.screenX - lastX
    const dy = e.screenY - lastY
    if (!dx && !dy) return
    lastX = e.screenX
    lastY = e.screenY
    const now = performance.now()
    const dtEv = Math.max(0.004, (now - (state.dragVec?.t || now - 16)) / 1000)
    state.dragVec = {
      vx: Math.max(-cap, Math.min(cap, dx / dtEv)),
      vy: Math.max(-cap, Math.min(cap, dy / dtEv)),
      t: now,
    }
    // 中键同样走事件驱动：报屏幕坐标，按帧合并
    move.queue(e.screenX, e.screenY)
  })
  const end = (e) => {
    if (!state.middleDragging) return
    move.flush()
    state.middleDragging = false
    state.windowDragging = false
    state.dragVec = null
    try { stage.releasePointerCapture(e.pointerId) } catch {}
    shell.dragEnd()
  }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', end)
  // 指针在窗口外松开时，stage 上的 pointerup 可能收不到（拖到一半切窗口/被抢焦点），
  // 那样主进程的拖动定时器会残留，窗口就会「自己跟着光标跑」——这是偶发位移的另一个来源。
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
}

// ---------- 右键弹窗：只剩「前倾 / 恢复」（设置与退出都在系统托盘） ----------
function showTools() {
  const t = $('#tools')
  if (!t) return
  // 以图层实际状态为准，别存布尔：设置里切过 / exprClear 清掉后也会显示错
  const lean = !!state.layers?.hasExpression?.('前倾')
  const btn = $('#tool-lean')
  if (btn) {
    btn.textContent = lean ? '恢复' : '前倾'
    btn.classList.toggle('on', lean)
  }
  t.classList.remove('hidden')
}
// 无头/测试页没有工具栏节点：这里不能因为 null.classList 直接抛，会把整套拖动带崩
function hideTools() { $('#tools')?.classList.add('hidden') }

/** 客户端坐标 → 命中的热区 */
function regionAtClient(x, y) {
  if (!state.store || !state.viewport) return null
  const p = state.viewport.clientToModel(x, y)
  return state.store.hit(p.x, p.y)
}

/**
 * 热区 → 客户端像素矩形（气泡定位 / 面板联动都用它）。
 * 换算方式与角色在窗口里的实际位置一致：canvas rect + 模型偏移 + 缩放。
 */
function regionScreenBox(name) {
  const r = state.store?.all?.find((x) => x.name === name)
  if (!r || !r.points?.length || !state.stage) return null
  const xs = r.points.map((p) => p[0])
  const ys = r.points.map((p) => p[1])
  const cr = state.stage.canvas.getBoundingClientRect()
  const sc = state.stage.model.scale.x
  const ms = state.stage.modelSize()
  const sx = (mx) => cr.left + state.stage.model.position.x + (mx - ms.width / 2) * sc
  const sy = (my) => cr.top + state.stage.model.position.y + (my - ms.height / 2) * sc
  return {
    left: sx(Math.min(...xs)), top: sy(Math.min(...ys)),
    right: sx(Math.max(...xs)), bottom: sy(Math.max(...ys)),
    width: (Math.max(...xs) - Math.min(...xs)) * sc,
    height: (Math.max(...ys) - Math.min(...ys)) * sc,
  }
}

/**
 * 头部右键：前倾做成**开关**（点一次开、再点一次关）。
 * 以**图层实际状态**为准（不存本地布尔）——否则设置里切过、或者被 exprClear 清掉之后，
 * 开关会显示「关」而模型其实还开着（反过来也有）。
 */
function toggleLean() {
  const def = (state.caps.expressions || []).find((x) => x.name === '前倾')
  if (!def) { toast('模型没有「前倾」表情'); return }
  const on = !!state.layers?.hasExpression?.('前倾')
  if (on) {
    // 静默切换：右键一下前倾、再右键恢复，不弹右上角提示（用户明确要求）
    state.layers.removeExpression('前倾')
  } else {
    state.layers.addExpression('前倾', def.params, { source: 'lean' })
  }
}

/** 点别处关掉弹窗（面板里例外：点面板不该收弹窗） */
function bindToolsDismiss() {
  window.addEventListener('pointerdown', (e) => {
    const t = $('#tools')
    if (!t || t.classList.contains('hidden')) return
    if (e.target?.closest?.('#tools')) return
    hideTools()
  }, true)
}

// ---------- 分区反应：改的是热区上的 reaction，reactions.apply 优先用它 ----------
// 反应存在热区上（region.reaction），reactions.apply 优先用它，其次才回落到 DEFAULT_REACTIONS。
// 所以这里改完直接 store.save()，重启保留。
function applyReaction(regionName, kind, { exprs = [], mode = 'expr' } = {}) {
  const region = state.store?.all?.find((r) => r.name === regionName)
  if (!region) return false
  const next = { ...(region.reaction || {}) }
  if (!exprs.length) delete next[kind]
  else next[kind] = mode === 'toggle' ? { toggle: exprs[0] } : { expr: exprs }
  region.reaction = next
  state.store.save(state.caps.model.name)
  return true
}

/** 热区反应快照：设置窗口拿它渲染勾选框 */
function reactionsSnapshot() {
  return Object.fromEntries((state.store?.all || []).map((r) => [r.name, r.reaction || {}]))
}

/**
 * 设置窗口 → 舞台窗口的 RPC（主进程用 executeJavaScript 调进来）。
 * 只处理「需要舞台内部状态」的三类事：读快照 / 改热区反应 / 导出补丁。
 * 纯设置项（缩放、跟随、气泡、置顶…）走主进程广播，不经过这里。
 */
/** 动作目录：舞台实际能执行的名字。桥接/agent 的提示词按这份生成，别再各写一份。 */
function actionCatalog() {
  const routines = Object.entries(ROUTINES).map(([name, r]) => ({ name, ms: Number(r.ms) || 0, emotion: !!r.emotion }))
  const idleRoutines = routines.filter((r) => !r.emotion)
  return {
    protocol: 1,
    poses: [...new Set([...OFFICIAL_POSES, ...Object.keys(POSES)])],
    gestures: GESTURE_NAMES.slice(),
    acts: idleRoutines.map((r) => r.name),
    emotions: routines.filter((r) => r.emotion).map((r) => r.name),
    idle: idleRoutines.map((r) => ({ name: r.name, ms: r.ms })),
    expressions: (state.caps?.expressions || []).map((e) => e.name),
    library: allPresetActions().map((p) => ({ name: p.name, kind: p.preset, pack: p.pack || null })),
    idleEnabled: state.settings?.idle !== false,
    idlePaused: !!state.idle?.state?.()?.paused,
    randomFaces: state.settings?.randomFaces !== false,
  }
}

async function stageRpc(op, payload) {
  if (op === 'meta') {
    return {
      model: state.caps?.model?.name || '',
      regions: (state.store?.all || []).map((r) => r.name),
      exprs: (state.caps?.expressions || []).map((e) => e.name),
      reactions: reactionsSnapshot(),
      poses: Object.keys(POSES).map((name) => ({ name, official: OFFICIAL_POSES.includes(name) })),
      bodyShape: state.bodyShape ?? 0,
      // 当前视口偏移（居中算得对不对，看这两个数就够了）
      view: state.viewport
        ? { zoom: state.viewport.view.zoom, offsetX: state.viewport.view.offsetX, offsetY: state.viewport.view.offsetY }
        : null,
      active: {
        exprs: (state.layers?.inspect?.()?.layers || []).map((l) => l.name),
        pose: state.poses?.state?.()?.active ?? null,
        hands: state.poses?.state?.()?.hands ?? null,
        skirt: skirtIsLong() ? 'long' : 'short',
        // 待机层现在在演什么 / 下一次多久之后；随机小表情开没开、正在演哪个
        idle: state.idle?.state?.() ?? null,
        randomFaces: state.settings?.randomFaces !== false,
        faceNow: state.idleFaces?.state?.() ?? null,
      },
    }
  }
  // 动作目录（agent / 桥接的清单源）
  if (op === 'catalog') return actionCatalog()
  // 编辑台（浏览器）要热区几何：只读快照，不改状态
  if (op === 'regions') {
    return (state.store?.all || []).map((r) => ({
      name: r.name, z: r.z ?? 0, points: r.points || [], holes: r.holes || [], reaction: r.reaction || {},
    }))
  }
  // 时间序列：最近的动作/互动/说话（agent 接话、调试都用它）
  if (op === 'history') return state.history?.summary?.() ?? null
  if (op === 'history-all') return state.history?.all?.(60) ?? []
  if (op === 'mood') return state.mood?.state?.() ?? null
  if (op === 'expr') {
    const name = String(payload?.name || '')
    const def = (state.caps?.expressions || []).find((e) => e.name === name)
    if (!def) return { error: `没有这个表情：${name}` }
    if (state.layers?.hasExpression?.(name)) state.layers.removeExpression(name)
    else state.layers?.addExpression(name, def.params, { source: 'manual', fade: 0.25 })
    return {
      active: {
        exprs: (state.layers?.inspect?.()?.layers || []).map((l) => l.name),
        pose: state.poses?.state?.()?.active ?? null,
      },
    }
  }
  if (op === 'pose') {
    const name = String(payload?.name || '')
    if (!POSES[name]) return { error: `没有这个姿势：${name}` }
    state.poses?.set(name, 320)
    if (name !== '默认手') armPoseAutoRelease()
    return { active: { exprs: (state.layers?.inspect?.()?.layers || []).map((l) => l.name), pose: state.poses?.state?.()?.active ?? null } }
  }
  if (op === 'exprClear') {
    for (const s of ['manual', 'mode', 'bus', 'agent', 'idle-exp', 'pinch', 'crotch-face']) state.layers?.removeSource(s)
    state.poses?.release(360)
    return { active: { exprs: [], pose: '默认手' } }
  }
  if (op === 'reaction') {
    const { region, kind = 'tap', exprs = [], mode = 'expr' } = payload || {}
    applyReaction(region, kind === 'pet' ? 'pet' : 'tap', { exprs, mode })
    return { reactions: reactionsSnapshot() }
  }
  if (op === 'reactionReset') {
    const region = state.store?.all?.find((r) => r.name === payload?.region)
    if (region) {
      const d = DEFAULT_REACTIONS[payload.region]
      region.reaction = d ? JSON.parse(JSON.stringify(d)) : {}
      state.store.save(state.caps.model.name)
    }
    return { reactions: reactionsSnapshot() }
  }
  /**
   * 体型量测（开发用）：身体段热区的模型坐标包围盒 + 头部当前屏幕矩形 + 视口参数。
   * 「体型一场网格就缩」这种问题肉眼量不准，拟合放大曲线全靠这组数。
   */
  if (op === 'measure') {
    const box = (pts) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const [x, y] of pts) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
    }
    const bands = {}
    for (const name of ['头', '胸', '腰', '胯', '裙摆', '腿', '脚', '尾巴', '左手', '右手']) {
      const r = state.store?.all?.find((x) => x.name === name)
      if (r?.points?.length) bands[name] = box(r.points)
    }
    const toScr = (b) => {
      if (!b) return null
      const a = state.viewport.modelToScreen(b.x0, b.y0)
      const c = state.viewport.modelToScreen(b.x1, b.y1)
      return { x0: a.x, y0: a.y, x1: c.x, y1: c.y, w: c.x - a.x, h: c.y - a.y }
    }
    return {
      bodyShape: state.bodyShape ?? 0,
      canvas: state.stage.modelSize(),
      win: { w: state.stage.app.screen.width, h: state.stage.app.screen.height },
      view: state.viewport
        ? { zoom: state.viewport.view.zoom, offsetX: state.viewport.view.offsetX, offsetY: state.viewport.view.offsetY }
        : null,
      bands,
      head: toScr(bands['头']),
      foot: toScr(bands['脚']),
      handsScreen: { 左手: toScr(bands['左手']), 右手: toScr(bands['右手']) },
      chestScreen: toScr(bands['胸']),
      legsDisabled: !!state.store?.all?.find((x) => x.name === '腿')?.disabled,
      longSkirt: (() => {
        const r = state.store?.all?.find((x) => x.name === '长裙')
        if (!r) return null
        return { disabled: !!r.disabled, z: r.z, points: r.points.length, box: toScr(box(r.points)) }
      })(),
      hands: state.poses?.state?.()?.hands ?? null,
      chestDisabled: !!state.store?.all?.find((x) => x.name === '胸')?.disabled,
      clothes1: (() => { try { return state.stage.param.get('Clothes1') } catch { return null } })(),
      exprs: (state.layers?.inspect?.()?.layers || []).map((l) => l.name),
    }
  }
  if (op === 'body') return { bodyShape: applyBodyShape(payload?.value) }
  // 手/臂等部件的**逐 drawable** 包围盒（骨骼标定用）：按 drawable 分组比合并顶点可靠，
  // 抬手时不会把两只手混成一个团。
  if (op === 'drawables') {
    const re = new RegExp(payload?.match || '手')
    const out = []
    const core = state.stage.core
    const im = state.stage.model.internalModel
    const n = core.getDrawableCount()
    for (let i = 0; i < n; i++) {
      let parent = -1
      try { parent = core.getDrawableParentPartIndex(i) } catch { parent = -1 }
      if (parent < 0) continue
      const name = state.partNames?.get?.(parent) || ''
      if (!re.test(name)) continue
      if (!(core.getDrawableOpacity(i) > 0.05)) continue
      let vtx
      try { vtx = im.getDrawableVertices(i) } catch { continue }
      if (!vtx || vtx.length < 6) continue
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let t = 0; t < vtx.length; t += 2) {
        const x = vtx[t], y = vtx[t + 1]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      if (!Number.isFinite(x0)) continue
      out.push({
        i, part: name,
        cx: Math.round((x0 + x1) / 2), cy: Math.round((y0 + y1) / 2),
        w: Math.round(x1 - x0), h: Math.round(y1 - y0),
      })
    }
    return out
  }
  // 单手开关：side = 'left'（竖食指）| 'right'（抚胸）
  if (op === 'hand') {
    const side = payload?.side === 'right' ? 'right' : 'left'
    const on = state.poses?.toggleHand?.(side) ?? ''
    return { side, on, hands: state.poses?.state?.()?.hands ?? null }
  }
  // 长短裙：不传 long 就反转
  if (op === 'skirt') {
    const wantLong = payload?.long === undefined ? !skirtIsLong() : !!payload.long
    return { long: setSkirtLong(wantLong) }
  }
  // 动作预设：按名字播一段；不传名字 = 列清单（含组合）
  if (op === 'act') {
    const name = String(payload?.name ?? '')
    const routines = state.idle?.routines?.() ?? []
    const combos = state.idle?.combos?.() ?? []
    if (!name) return { routines, combos }
    const played = state.idle?.trigger?.(name, { manual: true })
    if (!played) return { played: null, error: `没有这个动作：${name}`, routines, combos }
    return { played, routines, combos }
  }
  // 意图协议：整段文本进来，块外的字念出来，块里的指令执行
  if (op === 'intent') return speakAgent(String(payload?.text ?? ''))
  if (op === 'grammar') return { grammar: grammarText(), verbs: Object.keys(VERBS) }
  // 参数范围/默认值：骨架求解器要按行程归一化，别猜
  if (op === 'paramInfo') {
    const ids = Array.isArray(payload?.ids) ? payload.ids : (state.stage?.param?.ids || [])
    const out = {}
    for (const id of ids) {
      try { const i = state.stage.param.info(id); if (i) out[id] = i } catch {}
    }
    return out
  }
  if (op === 'patchExport') return exportStagePatch()
  if (op === 'mode') return { mode: applyMode(payload?.name) }
  return null
}
window.__stageRpc = stageRpc

// ---------- 设置同步：主进程广播 → 舞台立即生效 ----------
function applyPassState(on) {
  state.settings = state.settings || {}
  state.settings.clickThrough = !!on
  if (on) showPassHint()
  else hidePassHint()
  state.recomputePass?.()
}

/**
 * 把设置值落到各层。
 * 有意的**单向**：只读 settings、绝不回写 —— 否则「广播 → apply → shell.set → 广播」会打环。
 */
function applySettings(next) {
  if (!next || typeof next !== 'object') return
  state.settings = { ...state.settings, ...next }

  const zoom = Number(state.settings.zoom)
  // 只有 zoom 真的变了才重算居中：以前每次设置广播都会跑一遍 applyFit，
  // 而它依赖热区测量 → 偶发的像素差会把角色整体挪一下（身体轻微抖/位移）。
  if (Number.isFinite(zoom) && zoom !== state.zoomApplied) {
    state.zoomApplied = zoom
    // 拖边框缩放会从窗口高度反推 zoom：本地基准跟着走，滚轮才不会用旧值起步
    state.zoomLocal = zoom
    applyFit()
  }

  // 头部让位强度：动作抢头角时按幅度打折（见 onBeforePhysics 里的分档）
  const yieldK = Number(state.headYieldApplied ?? 1)
  const strength = Number(state.settings.strength ?? 1) * yieldK
  state.headYieldK = yieldK
  state.gaze?.set({ enabled: state.settings.gaze !== false, strength, headGain: Number(state.settings.headGain ?? 1.25) })
  state.posture?.set({ strength })
  state.petSway?.set({ gain: Number(state.settings.petGain ?? 1.6) })
  state.idle?.set({
    enabled: state.settings.idle !== false,
    speed: Number(state.settings.idleSpeed ?? 1),
    playback: Number(state.settings.actionSpeed ?? 0.8),
  })
  // 随机小表情：关掉后不再自己冒「笑 / 吐舌头」（正在演的那个也不打断，等它自己结束）
  state.idleFaces?.set({ auto: state.settings.randomFaces !== false })

  const bubbleOn = state.settings.bubble !== false
  if (!bubbleOn && state.bubble?.visible) state.bubble.hide()
  else if (bubbleOn && !state.bubble?.visible && state.bubble?.text) state.bubble.show()
  state.bubble?.setScale(bubbleScale())
  applyBorder(state.settings.border === true)
  // 体型（Clothes2）跟设置走：0 默认 / 0.4 体型1 / 1 体型2
  applyBodyShape(state.settings.bodyShape ?? 0)
  // 帧率：固定 60（用户不可调）。子窗口开着时临时降到 30，走的是同一条网格。
  applyFps()

  applyPassState(!!state.settings.clickThrough)
}

/**
 * 帧率档位：正常 60，子窗口开着时 30 —— 两档都只调「每几拍出一次帧」，
 * 实际出帧由 stage.frameLoop 按显示刷新周期锚定（240Hz 屏：60fps=4 拍，30fps=8 拍）。
 * 以前这里是 ticker.maxFPS，实测会在 3/4 拍之间随机跳，所以整条链路换掉了。
 */
function applyFps() {
  const fps = state.throttled ? 30 : (state.settings?.targetFps === 60 ? 60 : 30)
  const loop = state.stage?.frameLoop
  if (loop) loop.setFps(fps)
  // pixi7 实验引擎没有网格循环：只能退回限帧（观感不如网格锚定，但不至于失控）
  else if (state.stage?.ticker) state.stage.ticker.maxFPS = fps
  state.fps = fps
}

function bindSettings() {
  shell.onSettings?.((next) => applySettings(next))
  shell.onClickThrough?.((v) => applyPassState(!!v))
  // 设置/编辑器窗口打开时降帧到 30，避免和子窗口抢资源（表现为设置界面卡、舞台短卡顿）
  shell.onThrottle?.((on) => {
    state.throttled = !!on
    applyFps()
  })
  // 有新版本：气泡说一句就够（不抢正在说的台词）
  // 用独立状态 'update'：待机台词只覆盖 idle 状态，这样提醒不会说完就被盖掉；
  // 如果正被 DSH 状态（thinking/working）占着，就隔 20 秒再试，最多三次。
  const showUpdateNotice = (info, attempt = 0) => {
    const latest = String(info?.latest || '').trim()
    const text = latest ? `有新版本了哦（v${latest}）` : '有新版本了哦'
    state.update = info || null
    state.history?.push?.({ kind: 'say', text, source: 'update' })
    const b = state.bubble
    if (!b || state.settings.bubble === false) return
    const st = b.state?.()
    if (st?.visible && st.state && st.state !== 'idle' && st.state !== 'update') {
      if (attempt < 3) setTimeout(() => showUpdateNotice(info, attempt + 1), 20000)
      return
    }
    b.show(text, { state: 'update' })
    clearTimeout(state.updateHide)
    state.updateHide = setTimeout(() => {
      if (b.state?.().state === 'update') b.hide()
    }, 30000)
  }
  shell.onUpdateAvailable?.((info) => showUpdateNotice(info))
  // 窗口隐藏/最小化 → 真正停帧（主进程推送，比页面自己的 visibilitychange 可靠：
  // 各平台对「窗口被 hide()」算不算 document.hidden 并不一致）
  shell.onStageActive?.((on) => setStageActive(!!on))
  document.addEventListener('visibilitychange', () => setStageActive(!document.hidden))
}

/**
 * 可见性 → 是否出帧。
 * 舞台是 backgroundThrottling:false 的常驻窗：隐藏到托盘后 rAF 仍按显示刷新被唤醒，
 * 60 帧空转等于白占一个核。所以直接 cancel 掉 rAF，显示回来再重新挂上。
 */
function setStageActive(on) {
  stageActive = on
  const loop = state.stage?.frameLoop
  if (!loop || stageApplied === on) return
  stageApplied = on
  if (on) { loop.wake(); state.faults?.resetFrameClock?.() }
  else loop.halt()
}

// ---------- 右键：角色身上任意位置 → 前倾/恢复 直接切换 ----------
function bindTools() {
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    // 右键按住拖过窗口（搬完松手）时，浏览器仍会补一个 contextmenu —— 那一下不该切换前倾
    if (state.rightDragAt && performance.now() - state.rightDragAt < 500) return
    // 直接切，不弹右上角工具条、不弹提示：右键一次前倾，再右键恢复
    toggleLean()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTools()
  })
  $('#tool-lean')?.addEventListener('click', () => { toggleLean(); hideTools() })
}

/**
 * 中键滚轮缩放：只在「头 / 胸 / 腰 / 胯 / 裙」这些主体热区上生效。
 * 以前设置里那条「角色大小」滑块要来回拖、还看不到基准，现在是「指着哪儿缩哪儿」——
 * 窗口尺寸仍由 applyFit 跟着角色算，缩放的还是同一个 settings.zoom。
 *
 * 为什么是「按住中键 + 滚轮」而不是 Ctrl+滚轮：
 * Ctrl+滚轮 在 Windows 桌面上是「缩放桌面图标」，指针只要有一瞬落在透明区/桌面上，
 * 就会把用户的图标拉大拉小 —— 这条快捷键属于桌面，不该被我们抢。
 */
const ZOOM_ZONES = new Set(['头', '额头', '左脸', '右脸', '左手', '右手', '胸', '腰', '胯', '裙摆', '长裙', '尾巴', '腿', '脚'])
// 每格滚轮的缩放幅度：约 1.6%（deltaY=100 时）。中键缩放是「临时微调」，
// 以前 0.0018 是 20%/格，滚一格就跳一大截，根本对不准。
const ZOOM_PER_DELTA = 0.00016
function bindZoomWheel() {
  let acc = 0
  let raf = 0
  window.addEventListener('wheel', (e) => {
    // 4 = 中键按住（WheelEvent.buttons 位掩码）。没按中键就完全不插手。
    if (!(e.buttons & 4) && !e.shiftKey) return
    const r = regionAtClient(e.clientX, e.clientY)
    if (!r || !ZOOM_ZONES.has(r.name)) return
    e.preventDefault()
    acc += e.deltaY
    // 光标屏幕位置 + 本帧要落到的缩放值：applyFit 用它换算「矩形绕光标放大 k 倍」
    state.zoomSp = { sx: e.screenX, sy: e.screenY }
    // 一帧只结算一次：不丢格、不排队 IPC，也不会拿到过期的 settings.zoom
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const d = acc
      acc = 0
      const cur = Number(state.zoomLocal ?? state.settings?.zoom) || 1
      const next = Math.min(3, Math.max(0.3, cur * Math.exp(-d * ZOOM_PER_DELTA)))
      const snapped = Math.round(next * 200) / 200   // 0.5% 步进：够细，落盘也稳
      if (Math.abs(snapped - cur) < 0.002) return
      const sp = state.zoomSp || { sx: 0, sy: 0 }
      // k 用「实际会落到的 zoom 比」，不是理想值：窗口宽高会取整，比值不能凭空捏
      state.zoomLocal = snapped
      // 立刻生效：fitSize 直接读 settings.zoom，不再等主进程广播回来（省掉一个往返）
      state.settings.zoom = snapped
      state.zoomAnchor = null
      // 专用通道：只搬窗口，**不落盘、不广播、不刷托盘**。
      // 以前走 shell.set → 主进程 saveSettings（写 settings.json）+ 全窗口广播 + 重建托盘菜单，
      // 再叠上渲染层 70ms 尾沿防抖 —— 每格滚轮都在做一次磁盘写入，缩放自然慢半拍。
      const size = fitSize()
      if (size) {
        lastFitSize = { w: size.w, h: size.h }
        shell.zoom?.({ k: snapped / cur, sx: sp.sx, sy: sp.sy, w: size.w, h: size.h, zoom: snapped })
      }
      // 视口/气泡当场跟着走，不等下一次广播
      const f = headFit()
      state.viewport?.set({ zoom: f.zoom, offsetX: f.x, offsetY: f.y })
      state.bubble?.setScale(bubbleScale())
      state.bubble?.reposition()
      placeTailRestore($('#tail-restore'))
    })
  }, { passive: false })
}

/**
 * 调试探针（window.__probe / window.__pass）。
 *
 * 从 bootStage 与 bindPassThrough 里搬出来的：它们是开发期工具，不该和启动流程、
 * 穿透状态机缠在同一个函数里。除 motionState（惯性数值）外，全部依赖模块作用域。
 */
function installProbes({ motionState } = {}) {
  window.__probe = {
    /**
     * 互动差分诊断：不传参返回全部组合的差分 id；
     * 传部位 + 手势则返回当前情绪下的权重（看情绪把谁顶上来了）。
     */
    variants(key, gesture) {
      if (key) return state.variants?.debug?.(key, gesture) ?? null
      const out = {}
      for (const [k, byKind] of Object.entries(VARIANTS)) {
        out[k] = Object.fromEntries(Object.entries(byKind).map(([g, list]) => [g, list.map((v) => v.id)]))
      }
      return out
    },
    /** 差分权重（不抽签，纯看当前情绪的影响） */
    variantWeights(key, gesture, moodOverride) {
      const mood = moodOverride || state.mood?.state?.() || {}
      return (VARIANTS[key]?.[gesture] || []).map((v) => ({ id: v.id, weight: Math.round(weightOf(v, mood) * 100) / 100 }))
    },
    /** 最近一次执行的互动差分（气泡可能被 agent 覆盖，用它确认互动真的走了差分） */
    lastVariant: () => state.lastVariant || null,
    /** 直接抽一条试试（不改情绪）：返回抽中的 id 和台词 */
    variantPick(key, gesture) {
      const v = state.variants?.pick?.(key, gesture)
      return v ? { id: v.id, line: v.line } : null
    },
    /** 直接执行一条差分（诊断用：绕过热区模拟，验证表情/嘴形/动作有没有上） */
    variantRun(key, gesture) {
      const v = state.variants?.pick?.(key, gesture)
      if (!v) return null
      applyVariant(key, gesture, v, { rxRegion: { name: key } })
      return { id: v.id, line: v.line, expr: v.expr || null, act: v.act || null }
    },
    /** 覆写一个参数（持续生效，直到 clear） */
    param(id, v, blend = 'Overwrite') {
      state.layers.removeSource('probe')
      state.layers.addExpression('probe', [{ Id: id, Value: v, Blend: blend }], { fade: 0, source: 'probe' })
    },
    /** 一组参数同时覆写 */
    params(list, blend = 'Overwrite') {
      state.layers.removeSource('probe')
      state.layers.addExpression('probe', list.map(([Id, Value]) => ({ Id, Value, Blend: blend })), { fade: 0, source: 'probe' })
    },
    clear() { state.layers.removeSource('probe') },
    /** 诊断：直接写核心参数并立刻读回（判断「写不进去」还是「写完又被覆盖」） */
    setRead(id, v) {
      const idx = state.stage.param.index(id)
      const before = state.stage.param.get(id)
      state.stage.param.set(id, v)
      const after = state.stage.param.get(id)
      return { id, idx, before, after }
    },
    /** 诊断：在 beforeModelUpdate 末尾（各层写完之后）读一次 */
    readAtUpdate(id) {
      return new Promise((resolve) => {
        const off = state.stage.onBeforeUpdate(() => { const v = state.stage.param.get(id); off(); resolve(v) })
      })
    },
    /** 诊断：一次分层写入，在物理前/更新前各读一次值（判断写点与覆盖） */
    traceWrite(id, v) {
      state.layers.removeSource('probe')
      state.layers.addExpression('probe', [{ Id: id, Value: v, Blend: 'Overwrite' }], { fade: 0, source: 'probe' })
      return new Promise((resolve) => {
        const out = []
        const offPre = state.stage.onBeforePhysics(() => out.push(['pre', state.stage.param.get(id)]))
        const offPost = state.stage.onBeforeUpdate(() => out.push(['post', state.stage.param.get(id)]))
        setTimeout(() => {
          offPre(); offPost(); state.layers.removeSource('probe')
          resolve({ out: out.slice(0, 6), isIn: state.physics.inputs.has(id), isOut: state.physics.outputs.has(id) })
        }, 150)
      })
    },
    // ---- 捏脸 / 活气 / 嘴的探针 ----
    /** Ctrl+滚轮缩放：验证用，等价于在某个热区中心滚一格 */
    zoomAt(name, deltaY = -120) {
      const box = regionScreenBox(name)
      if (!box) return null
      const x = box.left + box.width / 2
      const y = box.top + box.height / 2
      window.dispatchEvent(new WheelEvent('wheel', {
        deltaY, buttons: 4,
        clientX: x, clientY: y,
        screenX: window.screenX + x, screenY: window.screenY + y,
        bubbles: true, cancelable: true,
      }))
      return { name, at: [Math.round(x), Math.round(y)], zoom: Number(state.settings?.zoom) || 1 }
    },
    zoom: () => Number(state.settings?.zoom) || 1,
    /** 轮廓掩码：读回区域（全帧 vs 包围盒）与覆盖率 */
    mask: () => state.mask && { w: state.mask.w, h: state.mask.h, coverage: +state.mask.coverage.toFixed(4), read: state.mask.read || null },
    /** 掩码读回统计：全帧 / 包围盒 / 贴边回退 各多少次 */
    maskStats: () => state.stage?.maskStats?.() || null,
    /** 模型坐标 → 窗口内客户端坐标（验证缩放锚点用） */
    clientAt(mx, my) {
      const st = state.stage
      if (!st) return null
      const cr = st.canvas.getBoundingClientRect()
      const sc = st.model.scale.x
      const ms = st.modelSize()
      return { x: cr.left + st.model.position.x + (mx - ms.width / 2) * sc, y: cr.top + st.model.position.y + (my - ms.height / 2) * sc }
    },
    modelAt: (x, y) => {
      const p = state.viewport?.clientToModel?.(x, y)
      return p ? { x: p.x, y: p.y } : null
    },
    regionBox: (name) => regionScreenBox(name),
    /**
     * 诊断/修复：贴图的 alpha 模式。
     * pixi7（cubism4mul）默认按「非预乘」上传，透明区 RGB 不是 0 的贴图会在边缘糊出彩边
     * （本模型 texture_02 透明区 RGB=25 → 尾巴一圈蓝色块边）。
     * 传 true 就把所有贴图切到预乘（PMA=1）并重新上传，肉眼可对比。
     */
    textures(fix = false) {
      const m = state.stage?.model
      const lists = [m?.textures, m?.internalModel?.textures, m?.internalModel?.model?.textures]
      const out = []
      for (const arr of lists) {
        if (!Array.isArray(arr) || !arr.length) continue
        for (const t of arr) {
          const bt = t?.baseTexture
          if (!bt) continue
          const before = bt.alphaMode
          const beforeMip = bt.mipmap
          if (fix) {
            bt.alphaMode = 1           // ALPHA_MODES.PMA = 预乘
            bt.mipmap = 0              // MIPMAP_MODES.OFF
            bt.scaleMode = 1           // LINEAR
            // 只改标志不重新上传 = 没改（GL 纹理还在用旧参数）。必须 dispose 后 update 重传。
            try { bt.dispose?.() } catch {}
            try { bt.update?.() } catch {}
          }
          out.push({ w: bt.width, h: bt.height, before, now: bt.alphaMode, mipBefore: beforeMip, mipNow: bt.mipmap, scaleMode: bt.scaleMode })
        }
        if (out.length) break
      }
      return out
    },
    /** 诊断：热区生成器在各自引擎下能不能读出几何（pixi7 曾经整片读不出来） */    zones() {
      const out = { count: state.store?.all?.length ?? null }
      const tries = {
        face: () => state.faceReader?.read?.(),
        forehead: () => state.faceReader?.readForehead?.(),
        hand: () => state.handReader?.read?.(),
      }
      for (const [k, fn] of Object.entries(tries)) {
        try {
          const v = fn()
          out[k] = Array.isArray(v) ? v.length : v ? 'pts' : 'null'
        } catch (e) { out[k] = 'ERR ' + (e?.message || e) }
      }
      out.names = (state.store?.all || []).map((r) => r.name)
      return out
    },
    /** 诊断：按当前网格算各段包围盒 —— 动态热区可行性/抖动/耗时都靠它量 */
    dynZones() {
      try {
        return bandBoxes({
          core: state.stage.core,
          internalModel: state.stage.model.internalModel,
          displayNames: state.partNames,
          canvas: state.stage.modelSize(),
        })
      } catch (e) { return { error: e?.message || String(e) } }
    },
    hitAt: (x, y) => regionAtClient(x, y)?.name ?? null,
    /** 该点是否落在角色不透明像素上（拖窗口的判定条件，验证用） */
    bodyAt: (x, y) => { try { return !!bodyAt(x, y) } catch { return false } },
    /** 拖动状态（诊断：窗口是否在跟手） */
    dragState: () => ({ left: !!state.windowDragging, middle: !!state.middleDragging, region: !!state.regionInput?.pressed?.region }),
    /** 冻结模式已移除：保留键名只为兼容旧脚本，永远报未冻结 */
    freeze: () => ({ frozen: false, ticker: !!state.stage?.ticker?.started }),
    /** 后台长记录：longStart() 开始，longStop() 取回长帧与同期掩码日志 */
    longStart(threshold = 26) {
      state.longGaps = []
      state.longOn = true
      state.longT0 = performance.now()
      let prev = performance.now()
      const step = () => {
        if (!state.longOn) return
        const now = performance.now()
        const d = now - prev
        if (d > threshold) state.longGaps.push({ t: Math.round(now - state.longT0), d: +d.toFixed(1) })
        prev = now
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
      return true
    },
    longStop() {
      state.longOn = false
      const t0 = state.longT0 || 0
      return {
        gaps: (state.longGaps || []).slice(0, 300),
        masks: (state.maskLog || []).filter((x) => x.t >= t0).map((x) => ({ t: Math.round(x.t - t0), ms: x.ms, read: x.read, down: x.down })),
      }
    },
    frameProbe(ms = 12000, threshold = 26) {
      return new Promise((resolve) => {
        const t0 = performance.now()
        const gaps = []
        let prev = t0
        const step = () => {
          const now = performance.now()
          const d = now - prev
          if (d > threshold) gaps.push({ t: Math.round(now - t0), d: +d.toFixed(1) })
          prev = now
          if (now - t0 < ms) requestAnimationFrame(step)
          else resolve({
            gaps: gaps.slice(0, 300),
            masks: (state.maskLog || [])
              .filter((x) => x.t >= t0)
              .map((x) => ({ t: Math.round(x.t - t0), ms: x.ms, read: x.read, down: x.down })),
          })
        }
        requestAnimationFrame(step)
      })
    },
    modelVisible(on) {
      const m = state.stage?.model
      if (!m) return null
      m.visible = !!on
      return !!m.visible
    },
    renderOnce() {
      const app = state.stage?.app
      if (!app?.render) return null
      const t0 = performance.now()
      app.render()
      return +(performance.now() - t0).toFixed(2)
    },
    /** 与基准脚本同口径：模型 update + 一帧绘制 */
    frameOnce(dt = 1 / 60) {
      const st = state.stage
      if (!st?.app?.render) return null
      const t0 = performance.now()
      st.model?.update?.(dt)
      st.app.render()
      return +(performance.now() - t0).toFixed(2)
    },
    /** 排障：直接把舞台/模型/内部模型的引用交出去 */
    refs() {
      const st = state.stage
      return { stage: st, app: st?.app, model: st?.model, im: st?.model?.internalModel }
    },
    /** 排障：舞台/模型/渲染器的实时状态 */
    debugStage() {
      const st = state.stage
      const m = st?.model
      const im = m?.internalModel
      const core = im?.coreModel
      return {
        ticker: st?.ticker ? { started: !!st.ticker.started, count: st.ticker.count, FPS: st.ticker.FPS } : null,
        appTicker: st?.app?.ticker ? { started: !!st.app.ticker.started } : null,
        children: st?.app?.stage?.children?.length ?? null,
        model: m ? {
          visible: m.visible, alpha: m.alpha, x: m.x, y: m.y,
          width: m.width, height: m.height,
          scaleX: m.scale?.x, scaleY: m.scale?.y,
          parent: !!m.parent, destroyed: !!m.destroyed,
        } : null,
        internal: im ? {
          rendererBound: !!im.renderer,
          drawables: core?._model?.drawables?.count ?? core?.getDrawableCount?.() ?? null,
          textures: im.textures?.length ?? null,
          masks: im.masks?.length ?? null,
          params: core?._model?.parameters?.count ?? null,
        } : null,
      }
    },
    /** 性能实验：单独停/起出帧，用来把「模型更新」和「绘制」拆开量（走网格循环的暂停） */
    tickerStop() { try { const l = state.stage?.frameLoop; if (l) l.pause(); else state.stage?.ticker?.stop(); return true } catch { return false } },
    tickerStart() { try { state.resetDt?.(); const l = state.stage?.frameLoop; if (l) l.resume(); else state.stage?.ticker?.start(); return true } catch { return false } },
    /** 出帧节奏自检：刷新周期 / 每帧占几拍 / 目标帧率 / 已出帧数 */
    frameInfo: () => state.stage?.frameLoop?.info?.() || null,
    /** 模型复杂度：绘制对象数 / 顶点数 / 遮罩数 / 参数数 */
    modelInfo() {
      try {
        const im = state.stage?.model?.internalModel
        const core = im?.coreModel
        const n = core?.getDrawableCount?.() || 0
        let areas = 0
        for (let i = 0; i < n; i += 1) areas += core.getDrawableVertexArea?.(i) || 0
        return {
          drawables: n,
          masks: im?.masks?.length ?? null,
          textures: im?.textures?.length ?? null,
          params: core?.getParameterCount?.() || 0,
          original: [im?.originalWidth, im?.originalHeight],
        }
      } catch (e) { return String(e?.message || e) }
    },
    /** 拖动采样：dragLog(true) 开始记录，dragLog() 取回 */
    dragLog(on) {
      if (on) { state.dragSamples = []; return true }
      if (on === false) { state.dragSamples = null; return true }
      return state.dragSamples || []
    },
    /** 按 rAF 记录窗口在屏幕上的实际位置（看拖动是否真的 60fps 平滑） */
    winSampleStart(ms = 2000) {
      state.winSamples = []
      const t0 = performance.now()
      const step = () => {
        state.winSamples.push({ t: Math.round(performance.now() - t0), x: window.screenX, y: window.screenY })
        if (performance.now() - t0 < ms) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
      return true
    },
    winSamples: () => state.winSamples || [],
    /** 动作写头角时视线是否已让位（验证用） */
    yieldHead: () => !!state.yieldHead,
    gazeStrength: () => Number(state.gaze?.options?.strength),
    pinch(side = 'L', px = 320) { state.facePinch?.grab(side); state.facePinch?.move(px, 0) },
    pinchEnd() { state.facePinch?.release() },
    pinchState: () => state.facePinch?.state() ?? null,
    flap(side = 'L', amp = 1) { state.life?.flap(side, amp) },
    life: () => state.life?.state() ?? null,
    talk(v = 0) { state.mouth?.speak(v) },
    /** 直接触发某个部位的情绪嘴形（截图/验证用，等价于摸到那个部位） */
    mood(name) {
      const m = REGION_MOUTH[name]
      if (m) state.mouth?.setMood(m, m.ms)
      return m ? { name, ...m } : null
    },
    moods: () => Object.keys(REGION_MOUTH),
    clearMood() { state.mouth?.clearMood() },
    faces: () => state.idleFaces?.presets() ?? [],
    face(name) { return state.idleFaces?.trigger(name) ?? null },
    faceState: () => state.idleFaces?.state() ?? null,
    /** 终点姿势：预设清单 / 切换 / 状态（数值来自模型自带 motion3 末帧） */
    poses: () => state.poses?.presets() ?? [],
    /** 待机动作：清单 / 立刻播一个（不传名字则随机）/ 状态 */
    idleList: () => state.idle?.routines() ?? [],
    idlePlay(name) { return state.idle?.trigger(name, { manual: true }) ?? null },
    /** 待机随机动作开关（验证「关了待机，agent 动作仍然要播」） */
    idleEnabled(on) { state.idle?.set({ enabled: !!on }); return !!on },
    /** 动作播放速度（0.4–1，1 = 预设速度上限）；返回生效值 */
    setPlayback(v) { state.idle?.set({ playback: Number(v) || 1 }); return state.idle?.options?.playback ?? null },
    /** 当前动作剩余的真实时长（含播放速度） */
    idleRemaining: () => state.idle?.remaining?.() ?? 0,
    /** 表情默认存活时长（验证「没给 ms 的表情也会自己退」） */
    exprTtl(ms) { state.exprTtlMs = Number(ms) || 0; return state.exprTtlMs },
    /** 气泡停留：T = max(说话时长, 动作时长, 900) */
    bubbleHold: (text, actionMs = 0) => finalHoldMs(state.mouth?.durationOf?.(text) || 0, actionMs),
    idleState: () => state.idle?.state() ?? null,
    /** 时间序列摘要（动作/互动/说话） */
    history: () => state.history?.summary?.() ?? null,
    /** 情绪权重（害羞/生气/开心/好奇/困倦） */
    mood: () => state.mood?.state?.() ?? null,
    /** 痒痒的：立刻来一段（验证躲痒动作） */
    tickle() { state.tickle?.start(); return state.tickle?.state() ?? null },
    tickleState: () => state.tickle?.state() ?? null,
    /** 模型三态：常态 / 爱心眼 / 黑框眼镜 */
    mode(name) { return { mode: applyMode(name) } },
    modeState: () => ({ mode: modeName, list: MODE_LIST }),
    cycleMode: () => ({ mode: cycleMode() }),
    /** 视口状态（含镜像 flipX，验证镜像摇摆用） */
    viewport: () => ({ ...state.viewport?.view }),
    /** 摸胯神态（半睁眼 + 眯眼 + 八字眉）单独验证 */
    crotchFace(on = true) { crotchFace(on); return true },
    pose(name, ms = 260) { const ok = state.poses?.set(name, ms) ?? false; if (ok && name !== '默认手') armPoseAutoRelease(); return ok },
    poseState: () => state.poses?.state() ?? null,
    /** 姿势族内微调（加性偏移；不会破坏落点） */
    tune(map = {}, ms = 220) { return state.poses?.tune(map, ms) ?? null },
    tuneClear(ms = 220) { return state.poses?.clearTune(ms) ?? null },
    tuneState: () => state.poses?.tuneState() ?? null,
    /** 气泡：说一句 / 换文字 / 收起 / 读状态（验证自适应排版用） */
    bubble(text, st) {
      if (!state.bubble) return null
      if (text == null) { state.bubble.hide(); return null }
      state.bubble.show(String(text), { state: st })
      return state.bubble.state()
    },
    bubbleHide() { state.bubble?.hide() },
    bubbleState: () => state.bubble?.state() ?? null,
    /** 说一句预设台词（thinking / working / waiting / success / error / head / hand …） */
    say(key, ms = 0) { return state.bubble?.say(key, { ms }) ?? null },
    /** 模拟一条 DSH 状态（不接插件时也能验证联动） */
    agent(snap) { state.agentLink?.apply(snap) },
    agentState: () => state.agentLink?.state() ?? null,
    // ---- 改动补丁 ----
    patchExport: () => exportStagePatch(),
    patchState: () => state.patch ? { model: state.patch.model, poses: Object.keys(state.patch.poses || {}), phrases: Object.keys(state.patch.phrases || {}), regions: state.patch.regions?.regions?.length ?? 0 } : null,
    /** 读一个像素的 RGBA（判断眼睛有没有闭：虹膜是蓝的，闭眼是皮肤色） */
    pixel: (x, y) => state.stage?.sampleAlpha?.(x, y) ?? null,
    mouth: () => state.mouth?.state() ?? null,
    /** 当前被 hold 钉住的参数（物理输出只能这样写；探针读参数会读到物理重算前的值） */
    held: () => state.layers?.held?.() ?? [],
    /** 口型总时长（由语速表决定）：只问时长，不动嘴 */
    speechMs: (text, opts) => state.mouth?.durationOf?.(text, opts) ?? 0,
    /** 手动启动姿势兜底收回（验证「忘了放手」的自动收回） */
    poseHold(ms) { armPoseAutoRelease(ms); return true },
    earNow: () => ['LEar1', 'LEar2', 'LEar3', 'REar1', 'ParamMouthOpenY', 'LeanInput', 'ParamAngleZ']
      .map((id) => `${id}=${Math.round((state.stage.param.get(id) || 0) * 100) / 100}`).join(' '),
    read: (id) => state.stage.param.get(id),
    /** 参数的定义区间（判断某个值是不是「超出范围被钳住」） */
    info: (id) => state.stage.param.info(id),
    /** 当前左右脸热区的包围盒（模型像素）——用来量化「仰头让脸变宽」 */
    faceBox() {
      const rs = (state.store?.all || []).filter((r) => r.name === '左脸' || r.name === '右脸')
      if (!rs.length) return null
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const r of rs) {
        for (const p of r.points || []) {
          if (p[0] < minX) minX = p[0]
          if (p[0] > maxX) maxX = p[0]
          if (p[1] < minY) minY = p[1]
          if (p[1] > maxY) maxY = p[1]
        }
      }
      return { w: Math.round(maxX - minX), h: Math.round(maxY - minY), y: Math.round((minY + maxY) / 2) }
    },
    /** 物理输出参数在 onBeforeUpdate（物理之后）还有没有值？
     *  有值 → 可以「叠加」；读到 0 → 只能整层接管。
     */
    physicsSample(ids = ['LEar1', 'LEar2', 'LEar3', 'FrontHairY1', 'SideHairY1', 'LateHairY1'], frames = 90) {
      return new Promise((resolve) => {
        const acc = {}
        for (const id of ids) acc[id] = { min: Infinity, max: -Infinity, n: 0, last: null }
        let left = frames
        const off = state.stage.onBeforeUpdate(() => {
          for (const id of ids) {
            const v = state.stage.param.get(id)
            if (v == null) continue
            const a = acc[id]
            if (v < a.min) a.min = v
            if (v > a.max) a.max = v
            a.last = Math.round(v * 100) / 100
            a.n += 1
          }
          if (--left <= 0) {
            off()
            for (const id of ids) {
              acc[id].min = Math.round(acc[id].min * 100) / 100
              acc[id].max = Math.round(acc[id].max * 100) / 100
            }
            resolve(acc)
          }
        })
      })
    },
    /** 物理「算之前」这一瞬看到的参数值 —— 判断物理到底吃到了什么 */
    preSample(ids = ['ParamAngleZ', 'ParamAngleY', 'ParamAngleX', 'ParamBreath', 'LeanInput', 'LEar1', 'FrontHairY1'], frames = 60) {
      return new Promise((resolve) => {
        const acc = {}
        for (const id of ids) acc[id] = { min: Infinity, max: -Infinity, n: 0 }
        let left = frames
        const off = state.stage.onBeforePhysics(() => {
          for (const id of ids) {
            const v = state.stage.param.get(id)
            if (v == null) continue
            const a = acc[id]
            if (v < a.min) a.min = v
            if (v > a.max) a.max = v
            a.n += 1
          }
          if (--left <= 0) {
            off()
            for (const id of ids) {
              acc[id].min = Math.round(acc[id].min * 10) / 10
              acc[id].max = Math.round(acc[id].max * 10) / 10
            }
            resolve(acc)
          }
        })
      })
    },
    phys: () => state.stage.physicsInfo(),
    cap: () => state.capture?.state() ?? null,
    posture: () => state.posture?.state() ?? null,
    motion: () => ({
      vx: Math.round(motionState.vx), vy: Math.round(motionState.vy),
      ax: Math.round(motionState.ax), ay: Math.round(motionState.ay),
      life: state.life?.state?.().ext ?? null,
    }),
    /** 用 shell.moveBy 摇窗口，模拟拖动带来的加速度（CDP 移动不了真实窗口） */
    shakeWindow(px = 36, steps = 24, interval = 40) {
      let i = 0
      const id = setInterval(() => {
        shell.moveBy(i % 2 ? px : -px, 0)
        if (++i >= steps) clearInterval(id)
      }, interval)
    },
    /** 关掉桌面光标反馈，让探针的合成鼠标事件不被真实光标覆盖 */
    desktopGaze(on) { window.__noDesktopGaze = !on },
    /** 在物理之前强行钉住某些参数（测物理响应用） */
    holdPre(list) {      state._holdPreOff?.()
      state._holdPreOff = state.stage.onBeforePhysics(() => {
        for (const [id, v] of list) state.stage.param.set(id, v)
      })
    },
    holdPreOff() { state._holdPreOff?.(); state._holdPreOff = null },
    /** 关掉自制活气层，用来单独观察模型自带物理 */
    lifeOff() { state.life.set({ windAmp: 0, windAmpX: 0, earTremor: 0, earAmp: 0, jewelAmp: 0, inertiaX: 0, inertiaY: 0, earMin: 9999, earMax: 9999 }) },
    lifeOn() { state.life.set({ windAmp: 0.035, windAmpX: 0.02, earTremor: 0.012, earAmp: 1, jewelAmp: 0.3, inertiaX: 0.85, inertiaY: 1, earMin: 5.5, earMax: 13 }) },
  }

  window.__pass = {
    bodyAt,
    refreshMask,
    // 表情/姿势层现状（排查「动作被谁盖了」用）
    layers: () => state.layers?.inspect?.() ?? null,
    // 活气层：眨眼计数 / 耳朵 / 风；伪面捕：呼吸值
    life: () => state.life?.state?.() ?? null,
    capture: () => state.capture?.state?.() ?? null,
    // 清掉所有表情来源 + 收回姿势（QA 用，避免上一轮试的参数残留）
    exprClear() {
      for (const s of ['bus', 'agent', 'idle-exp', 'probe', 'lean', 'manual', 'mode', 'body', 'pinch', 'crotch-face']) state.layers?.removeSource(s)
      state.poses?.release(0)
    },
    captureSet: (patch) => state.capture?.set(patch) ?? null,
    blink: () => state.life?.blinkNow?.() ?? null,
    lifeSet: (patch) => state.life?.set?.(patch) ?? null,
    gust: (amp = 2, ms = 2600) => state.life?.gust?.(amp, ms) ?? null,
    sway: (name) => state.petSway?.trigger(name),
    charRight: () => Math.round(charRightClient()),
    face: () => state.facePinch?.state() ?? null,
    faceCenter: () => {
      const r = state.store?.all?.find((x) => x.name === '脸')
      if (!r || !r.points?.length) return null
      const cx = r.points.reduce((s, p) => s + p[0], 0) / r.points.length
      const cy = r.points.reduce((s, p) => s + p[1], 0) / r.points.length
      const st = state.stage
      const cr = st.canvas.getBoundingClientRect()
      const sc = st.model.scale.x
      const ms = st.modelSize()
      return {
        x: cr.left + st.model.position.x + (cx - ms.width / 2) * sc,
        y: cr.top + st.model.position.y + (cy - ms.height / 2) * sc,
      }
    },
    regions: () => (state.store?.all || []).map((r) => ({ name: r.name, z: r.z })),
    /** 诊断：直接跑一遍热区构建器（脸/额头/手），看它们当下是不是返回空 */
    zoneBuild() {
      const out = {}
      const ctx = {
        core: state.stage?.core,
        internalModel: state.stage?.model?.internalModel,
        displayNames: state.partNames,
        canvas: state.stage?.modelSize?.(),
      }
      try { out.face = faceRegions(ctx).map((r) => r.name) } catch (e) { out.faceErr = String(e?.message || e) }
      try { out.forehead = foreheadRegion(ctx).map((r) => r.name) } catch (e) { out.foreheadErr = String(e?.message || e) }
      try { out.hand = state.handReader?.read?.().map((r) => r.name) || [] } catch (e) { out.handErr = String(e?.message || e) }
      out.bodyShape = state.bodyShape
      out.visible = (() => {
        try {
          const core = state.stage.core
          let on = 0
          for (let i = 0; i < core.getDrawableCount(); i += 1) if (core.getDrawableDynamicFlagIsVisible(i)) on += 1
          return on
        } catch { return -1 }
      })()
      return out
    },
    /** 当前在场的表情层（验证「摸手不该出竖食指」用） */
    exprs: () => state.layers?.inspect?.() ?? null,
    handBoxes: () => (state.store?.all || []).filter((r) => r.name === '左手' || r.name === '右手').map((r) => {
      const xs = (r.points || []).map((p) => p[0])
      const ys = (r.points || []).map((p) => p[1])
      return { name: r.name, z: r.z, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    }),
    handCount: () => state.handReader?.count?.() ?? -1,
    /** 热区 → 客户端像素矩形（调热区位置用） */
    screenBox: (name) => regionScreenBox(name),
    /** 绘制顺序排查：按部件名列出 drawable 的序号与不透明度（判断手有没有被裙子盖住） */
    partOpacity(name) {
      const st = state.stage
      const p = (state.caps.parts || []).find((x) => x.name === name)
      if (!st || !p) return null
      return st.part?.get?.(p.id) ?? null
    },
    partSet(name, v) {
      const st = state.stage
      const p = (state.caps.parts || []).find((x) => x.name === name)
      if (!st || !p) return false
      st.part?.set?.(p.id, v)
      return true
    },
    drawables(filter) {
      const out = []
      const core = state.stage?.core
      if (!core) return out
      for (let i = 0; i < core.getDrawableCount(); i++) {
        let parent = -1
        try { parent = core.getDrawableParentPartIndex(i) } catch { continue }
        if (parent < 0) continue
        let name = ''
        try {
          const pid = csmName(core.getPartId(parent))
          name = state.caps.parts.find((p) => p.id === pid)?.name || ''
        } catch {}
        if (filter && !name.includes(filter)) continue
        out.push({ i, part: name, op: Math.round((core.getDrawableOpacity(i) || 0) * 100) / 100 })
      }
      return out
    },
    leanState: () => {
      const def = (state.caps?.expressions || []).find((x) => x.name === '前倾')
      const list = def?.params || []
      return {
        def: list,
        active: !!state.layers?.hasExpression?.('前倾'),
        // def.params 是数组，直接 map 取 Id；以前用 Object.keys 拿到的是下标 "0"，读出来全是 null
        values: list.map((p) => [p.Id, state.stage?.param.get(p.Id), state.stage?.param.info(p.Id)?.min, state.stage?.param.info(p.Id)?.max]),
      }
    },
    tryLean: () => toggleLean(),
    cheekTest: (s) => state.facePinch?.test(s),
    faceVerts: () => {
      // 「脸」部件所有网格顶点的平均坐标（看变形是否真的动）
      const core = state.stage.core
      const im = state.stage.model.internalModel
      let sx = 0, sy = 0, n2 = 0
      const n = core.getDrawableCount()
      for (let i = 0; i < n; i++) {
        let parent = -1
        try { parent = core.getDrawableParentPartIndex(i) } catch { continue }
        if (parent < 0) continue
        let name = ''
        try { name = state.caps.parts.find((p) => p.id === csmName(core.getPartId(parent)))?.name || '' } catch {}
        if (!/^脸$|^脸底$/.test(name)) continue
        let v = null
        try { v = im.getDrawableVertices(i) } catch { continue }
        if (!v) continue
        for (let k = 0; k < v.length; k += 2) { sx += v[k]; sy += v[k + 1]; n2++ }
      }
      return n2 ? { x: Math.round(sx / n2), y: Math.round(sy / n2), n: n2 } : null
    },
    regionAt: (x, y) => regionAtClient(x, y)?.name ?? null,
    regionCenter: (name) => {
      const r = state.store?.all?.find((x) => x.name === name)
      if (!r || !r.points?.length) return null
      const mx = r.points.reduce((s, p) => s + p[0], 0) / r.points.length
      const my = r.points.reduce((s, p) => s + p[1], 0) / r.points.length
      return state.viewport.modelToScreen(mx, my)
    },
    regionDebug: (x, y) => {
      const p = state.viewport.clientToModel(x, y)
      const rows = (state.store?.all || []).map((r) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const [px, py] of r.points || []) {
          if (px < minX) minX = px
          if (px > maxX) maxX = px
          if (py < minY) minY = py
          if (py > maxY) maxY = py
        }
        return { name: r.name, z: r.z, minX: Math.round(minX), minY: Math.round(minY), maxX: Math.round(maxX), maxY: Math.round(maxY) }
      })
      return { model: { x: Math.round(p.x), y: Math.round(p.y) }, rows }
    },
    zoom: (z) => state.viewport.set({ zoom: z }),
    pinchTest: (dx, dy) => { state.facePinch.grab(); state.facePinch.move(dx, dy) },
    pinchReset: () => state.facePinch.release(),
    mask: () => state.mask && { w: state.mask.w, h: state.mask.h, coverage: +state.mask.coverage.toFixed(4), read: state.mask.read || null },
    /** 视口状态（缩放/偏移/实际像素缩放）—— 排查「窗口跟着角色」时的落点 */
    view: () => (state.viewport ? { ...state.viewport.view, scale: state.stage?.model?.scale?.x ?? null } : null),
    dragState: () => ({ dragging: !!state.windowDragging, vec: state.dragVec || null }),
    leanToggle: () => { toggleLean(); return !!state.layers?.hasExpression?.('前倾') },
    /** 跟随层的内部状态（平滑后的眼/头/身），排查「头不转」时看它到底是没算还是有被覆盖 */
    gazeState: () => state.gaze?.state?.() ?? null,
    gazeOpts: () => (state.gaze?.options ? { ...state.gaze.options } : null),
    /** 姿态总线的当前合成值（排查「写了没生效 / 谁盖了谁」时看这一份） */
    pose: () => state.poseBus?.snapshot?.() ?? null,
    bus: () => state.poseBus?.snapshot?.() ?? null,
    /** 关掉伪面捕通道（排查「写了 ParamAngleX 头不动」时用） */
    captureOff(on = true) {
      state.capture?.set(on
        ? { breathAmp: 0, yawGain: 0, pitchGain: 0, tiltGain: 0, posGain: 0, jawFromMouth: 0 }
        : { breathAmp: 0.4, yawGain: 0.4, pitchGain: 0.4, tiltGain: 1, posGain: 1, jawFromMouth: 1 })
      return state.capture?.options ?? null
    },
    /** 手动给一个跟随目标（-1..1，右/上为正）：不移动真实鼠标也能验证转头幅度 */
    gazeTarget(nx = 0, ny = 0) {
      state.gaze?.setTarget(Number(nx), Number(ny))
      return state.gaze?.state?.().target ?? null
    },
    /** 真实轮廓在窗口里的包围盒（客户端像素）+ 相对窗口中心的偏移 dx/dy */
    maskBox: () => {
      const m = state.mask || refreshMask(true)
      if (!m?.data) return null
      let minX = m.w, maxX = -1, minY = m.h, maxY = -1
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          if (m.data[y * m.w + x] > 8) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX < 0) return null
      const W = window.innerWidth
      const H = window.innerHeight
      const box = {
        left: +((minX / m.w) * W).toFixed(1),
        top: +((minY / m.h) * H).toFixed(1),
        right: +(((maxX + 1) / m.w) * W).toFixed(1),
        bottom: +(((maxY + 1) / m.h) * H).toFixed(1),
      }
      box.w = +(box.right - box.left).toFixed(1)
      box.h = +(box.bottom - box.top).toFixed(1)
      box.dx = +((box.left + box.right) / 2 - W / 2).toFixed(1)
      box.dy = +((box.top + box.bottom) / 2 - H / 2).toFixed(1)
      box.margin = { left: +box.left.toFixed(0), top: +box.top.toFixed(0), right: +(W - box.right).toFixed(0), bottom: +(H - box.bottom).toFixed(0) }
      return box
    },
    state: () => ({ ignoring: state.ignoring, clickThrough: state.settings?.clickThrough, pointerDown: state.pointerDown }),
    /** 给定客户端坐标的穿透判定（只算不应用，不受事件送达影响） */
    passAt: (x, y) => state.passThrough?.decideAt(x, y) ?? null,
  }

  // 布局 / 跟随的验证钩子（和 harness 里的 __reaction 一样，只为无头检查）
  window.__layout = () => ({
    win: [window.innerWidth, window.innerHeight],
    pos: [Math.round(window.screenX), Math.round(window.screenY)],
    offsetX: state.viewport?.view.offsetX ?? null,
    offsetY: state.viewport?.view.offsetY ?? null,
    model: state.stage ? [Math.round(state.stage.model.position.x), Math.round(state.stage.model.position.y)] : null,
    gaze: state.gaze?.state?.().target ?? null,
    sway: state.petSway?.state?.() ?? null,
    angles: state.stage ? ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'].map((id) => Math.round(state.stage.param.get(id) * 10) / 10) : null,
    lean: state.stage ? Math.round(state.stage.param.get('LeanInput') * 10) / 10 : null,
  })
}

main()
