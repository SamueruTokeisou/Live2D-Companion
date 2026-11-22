// 编辑台（融合版，浏览器 webUI）：动作库 + 关键帧编辑 + 交互实测 + 诊断。
//
// 它把原来「动作编辑器」和「验证台」的能力并到一页里：
//   · 动作库：内置待机动作（可装载成可编辑关键帧）、官方 motion3（直接试播）、
//     表情（叠加预览）、热区（点选高亮 + 点击实测命中）；
//   · 编辑：关键帧 / 参数 / 速度 / 配字，和以前一样；
//   · 实测：交互（视线跟随）/ 热区命中 / 物理链与受控参数诊断。
//
// 存储走本地服务的 /api/actions（主进程持有 userData），浏览器里打不开服务时回落 localStorage。
// 官方 motion3 播放期间暂停关键帧写入，否则两套参数会互相打架。

import { createStage, MotionPriority, csmText } from '../src/stage/engine.js'
import { createViewport } from '../src/stage/viewport.js'
import { allPresetActions } from '../src/stage/action-presets.js'
import { POSES } from '../src/stage/poses.js'
import { pointInPolygon, seedRegions } from '../src/stage/regions.js'
import { initTheme, mountThemeSwitch } from './theme.js'

const TOKEN = new URLSearchParams(location.search).get('token') || ''
const apiHeaders = (json = false) => ({
  ...(json ? { 'content-type': 'application/json' } : {}),
  ...(TOKEN ? { 'x-stage-token': TOKEN } : {}),
})

const $ = (s) => document.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const STORE_KEY = 'live2d-editor/actions/v1'
const VIEW_KEY = 'live2d-editor/view/v1'
// 平移动量存的是「半窗宽」为单位：±4 表示可以把模型推到 4 个半窗之外。
// 以前锁死在 ±1，放大到 3 倍以后往边上一拖就撞墙 —— 这就是「拖到死区」的来源。
const PAN_LIMIT = 4
const ZOOM_MIN = 0.3
const ZOOM_MAX = 6

// 模型里这些参数的名字不直观（「2. 抚胸」「Lean Input」「光2/光4」），
// 给它补一层中文别名，搜索和治疗都用得上 —— 用户按直觉搜「前倾」「换手」就能找到。
const PARAM_ALIAS = {
  Movement1: '狗尾草',
  Movement2: '抚胸 举手',
  Movement3: '竖食指',
  LeanInput: '前倾 后仰 凑近',
  Param50: '前倾权重',
  Param56: '换手A 光2',
  Param57: '换手B 光4',
  Param38: '双手开关',
  Param35: '手臂开关',
  Param25: '右手Z',
  Param59: '大臂透视',
  Param60: '左小臂',
  Param61: '左手腕',
  Param62: '左大臂',
}
const aliasOf = (id) => PARAM_ALIAS[id] || ''
const haystackOf = (p) => `${p.name} ${p.id} ${aliasOf(p.id)}`.toLowerCase()

const S = {
  caps: null,
  stage: null,
  viewport: null,
  actions: [],
  cur: null,
  time: 0,
  playing: false,
  view: { zoom: 1, offsetX: 0, offsetY: 0 },
  clip: null,          // 复制下来的关键帧值
  // 预览播放速度：1.0 = 预设速度上限（与舞台一致，上限锁 1，再快手就像瞬移）
  speed: 1,
  saveTimer: 0,
  rafId: 0,
  toastTimer: 0,
  // ---- 融合进来的实测能力 ----
  lib: { presets: [], motions: [], exprs: [], regions: [] },
  exprParams: {},      // 当前叠加的表情参数（合并后写到物理前）
  flash: new Set(),    // 临时表情（点/摸热区触发，到时间自动撤；不再和手动勾选的混在一起）
  flashTimer: 0,
  modeIdx: -1,         // 点额头：爱心眼 → 黑框眼镜 → 常态 循环
  written: new Set(),  // 上一帧真正写过的参数 id：这一帧不写了就回默认，防止切动作后串台
  motionPlaying: false,// 官方 motion3 期间让关键帧写入让位
  interact: false,     // 交互：视线/头部跟随鼠标
  showRegions: false,
  gaze: { x: 0, y: 0 },// 目标视线（-1..1），每帧向它逼近
  gazeNow: { x: 0, y: 0 },
  hit: null,           // 最近一次点击命中的热区
  selectedRegion: null,// 动作库里点选的热区（高亮用）
  exprsOn: new Set(),  // 当前叠加的表情名
  src: 'acts',         // 左栏当前标签：acts（我的动作 + 动作库） / on（启用）
  stageMeta: null,     // 舞台侧快照（/api/stage/meta）：启用列表用它显示「舞台上真正在用的东西」
  lastTouch: null,     // 最近一次点/摸：{ region, kind, rx }
  petRegion: null,     // 拖动中已经触发过抚摸的热区（一次按住只触发一次）
}

/** 头部 / 身体角度：动作写了这些参数时，鼠标追踪必须让位（否则角度叠加，看起来像甩头） */
const HEAD_IDS = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ']
function actionTakesHead(a) {
  if (!a) return false
  if (HEAD_IDS.some((id) => (a.params || []).includes(id))) return true
  if (a.base && HEAD_IDS.some((id) => a.base[id] != null)) return true
  return (a.keys || []).some((k) => HEAD_IDS.some((id) => k.values?.[id] != null))
}

/* ───────────────────────── 小工具 ───────────────────────── */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.add('on')
  clearTimeout(S.toastTimer)
  S.toastTimer = setTimeout(() => el.classList.remove('on'), 1600)
}

const infoOf = (id) => S.stage?.param?.info(id) ?? { min: -1, max: 1, default: 0 }

/** 某个参数在时间 t 的值：关键帧之间线性插值，两端取端点值 */
function valueAt(action, id, t) {
  if (!action) return null
  const pts = []
  for (const k of action.keys) if (k.values && k.values[id] != null) pts.push([k.t, k.values[id]])
  if (!pts.length) return null
  pts.sort((a, b) => a[0] - b[0])
  if (t <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i += 1) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1]
      const [t1, v1] = pts[i]
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
      return v0 + (v1 - v0) * k
    }
  }
  return pts[pts.length - 1][1]
}

const keyAt = (action, t) => action?.keys.find((k) => Math.abs(k.t - t) < 0.5) || null

/**
 * 归一化曲线（[[t,v],...]，t 是 0..1）在 p 处的值。
 * holds 存的就是这种曲线：舞台按动作进度采样后写绝对值，编辑台照抄同一步。
 * 以前直接把数组当数值写 → NaN 进物理 → 头/头发整块画没（踩过）。
 */
function curveAt(spec, p) {
  if (typeof spec === 'number') return spec
  if (!Array.isArray(spec) || !spec.length) return null
  const keys = spec
  const q = clamp(Number(p) || 0, 0, 1)
  if (q <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i += 1) {
    if (q <= keys[i][0]) {
      const [t0, v0] = keys[i - 1]
      const [t1, v1] = keys[i]
      const k = t1 === t0 ? 0 : (q - t0) / (t1 - t0)
      const e = k * k * (3 - 2 * k)
      return v0 + (v1 - v0) * e
    }
  }
  return keys[keys.length - 1][1]
}

/** 找到时间 t 的关键帧，没有就建一个（拖动滑块时自动落关键帧） */
function ensureKey(action, t) {
  const hit = keyAt(action, t)
  if (hit) return hit
  const k = { t: Math.round(t), values: {} }
  action.keys.push(k)
  action.keys.sort((a, b) => a.t - b.t)
  return k
}

/* ───────────────────────── 视图（大小 / 位置） ───────────────────────── */

function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null')
    if (v && typeof v === 'object') {
      S.view = {
        zoom: clamp(Number(v.zoom) || 1, ZOOM_MIN, ZOOM_MAX),
        offsetX: clamp(Number(v.offsetX) || 0, -PAN_LIMIT, PAN_LIMIT),
        offsetY: clamp(Number(v.offsetY) || 0, -PAN_LIMIT, PAN_LIMIT),
      }
    }
  } catch { /* 没存过：用默认 */ }
}

function saveView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(S.view)) } catch {}
}

function setView(patch, { silent = false } = {}) {
  Object.assign(S.view, patch)
  S.view.zoom = clamp(S.view.zoom, ZOOM_MIN, ZOOM_MAX)
  S.view.offsetX = clamp(S.view.offsetX, -PAN_LIMIT, PAN_LIMIT)
  S.view.offsetY = clamp(S.view.offsetY, -PAN_LIMIT, PAN_LIMIT)
  S.viewport?.set({ ...S.view })
  renderView()
  saveView()
  drawRegions()
  if (!silent) hintOnce()
}

function renderView() {
  $('#v-zoom').value = String(S.view.zoom)
  $('#v-x').value = String(S.view.offsetX)
  $('#v-y').value = String(S.view.offsetY)
  $('#v-zoom-out').textContent = `${S.view.zoom.toFixed(2)}×`
  $('#v-x-out').textContent = S.view.offsetX.toFixed(2)
  $('#v-y-out').textContent = S.view.offsetY.toFixed(2)
}

let hintDone = false
function hintOnce() {
  if (hintDone) return
  hintDone = true
  const el = $('#preview-hint')
  el.style.transition = 'opacity .4s'
  el.style.opacity = '0'
}

/* ───────────────────────── 预览 ───────────────────────── */

async function bootPreview() {
  const modelUrl = new URL(S.caps.model.url, location.href).href
  S.stage = await createStage({
    container: $('#preview'),
    modelUrl,
    backgroundAlpha: 0,
    autoStart: true,
  })
  S.viewport = createViewport({ model: S.stage.model, app: S.stage.app })
  S.viewport.observe($('#preview'))

  // 每帧把「当前时间的关键帧值」写进模型。
  // 必须走引擎的 onBeforeUpdate：直接 internalModel.on('beforeModelUpdate') 拿不到内核真正
  // 用的那个发射器（实测写了完全没反应），别改回去。
  //
  // ⚠️ LeanInput / 手臂链这些是**物理输入**：物理算完之后再写，物理已经用旧值算过一遍，
  // 表现就是「前倾调了没反应」。所以两边都要写：物理前写一次让物理按新值算，物理后再写一次
  // 保证画面看到的就是这个值（和舞台的 pose-bus 同一个套路）。
  //
  // 另外注意：引擎 update 的最后一步是 `model.loadParameters()`（把动作前的快照还原），
  // 所以**帧间读参数读不到我们写的值** —— 看着像「没写进去」，实际渲染那一帧是对的。
  // 判断有没有生效要看画面/网格，别看 param.get。
  const collectWrite = () => {
    const vals = new Map()
    // 交互：视线/头部先逼近目标值（这几路是物理输入，必须物理前写）。
    // 当前动作本身写了头部/身体角度时整体让位 —— 两套角度叠在一起会「越转越大」再回弹。
    if (S.interact && !actionTakesHead(S.cur)) {
      const k = 0.18
      S.gazeNow.x += (S.gaze.x - S.gazeNow.x) * k
      S.gazeNow.y += (S.gaze.y - S.gazeNow.y) * k
      const g = S.gazeNow
      vals.set('ParamAngleX', g.x * 18)
      vals.set('ParamAngleY', -g.y * 12)
      vals.set('ParamAngleZ', g.x * 3)
      vals.set('ParamEyeBallX', g.x)
      vals.set('ParamEyeBallY', -g.y)
    }
    const cur = S.cur
    if (cur) {
      // 姿势族基底（内置待机动作会切手型）先写，再叠关键帧
      for (const [id, v] of Object.entries(cur.base || {})) vals.set(id, v)
      for (const id of cur.params) {
        const v = valueAt(cur, id, S.time)
        if (v != null) vals.set(id, v)
      }
    }
    // 表情叠加：和舞台「点一下表情」一致，直接压参数
    for (const [id, v] of Object.entries(S.exprParams)) vals.set(id, v)
    return vals
  }

  /**
   * 写入 + **清掉上一帧还在写、这一帧不写了的参数**。
   *
   * 这条是「部分预设会串台」的根因：以前只写不还，切到另一个动作后，
   * 上一个动作的手型（Movement/Param5x）、表情参数会一直挂在模型上 ——
   * 于是「东张西望」里还举着上一轮竖起来的食指，看着像预设互相污染。
   * holds 例外：它在物理后写，这里清掉也会被同一帧的 writeHolds 盖回来。
   */
  const applyWrite = (vals) => {
    const st = S.stage
    if (!st) return
    for (const id of S.written) {
      if (vals.has(id)) continue
      if (S.cur?.holds && Object.prototype.hasOwnProperty.call(S.cur.holds, id)) continue
      const info = st.param.info(id)
      st.param.set(id, info && Number.isFinite(info.default) ? info.default : 0)
    }
    for (const [id, v] of vals) st.param.set(id, v)
    S.written = new Set(vals.keys())
  }

  const writeParams = () => {
    const st = S.stage
    if (!st || S.motionPlaying) return   // 官方 motion3 播放中：参数交给它，别抢
    applyWrite(collectWrite())
  }
  // 物理输出参数（腿/脚角度这类）只能在物理之后写：舞台的 holds 层就是这个语义。
  // 以前编辑台只写关键帧，所以「扭扭腿」这种动作在预览里永远复现不出来。
  // holds 的值是归一化曲线：按当前播放进度采样，绝不能把数组直接塞给 param.set。
  const writeHolds = () => {
    const st = S.stage
    if (!st || S.motionPlaying) return
    const cur = S.cur
    if (!cur) return
    const dur = Math.max(100, Math.round(cur.duration || 1200))
    const p = clamp(S.time / dur, 0, 1)
    for (const [id, spec] of Object.entries(cur.holds || {})) {
      const v = curveAt(spec, p)
      if (v != null && Number.isFinite(v)) st.param.set(id, v)
    }
  }
  S.stage.onBeforePhysics(writeParams)
  S.stage.onBeforeUpdate(writeParams)
  S.stage.onBeforeUpdate(writeHolds)

  setView({ ...S.view }, { silent: true })
}

/* ───────────────────────── 动作数据 ───────────────────────── */

function newAction(name = '新动作') {
  return {
    id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name,
    trigger: 'manual',
    duration: 1200,
    lines: [],
    params: [],
    keys: [{ t: 0, values: {} }],
  }
}

function loadJSON(data) {
  if (!data || !Array.isArray(data.actions) || !data.actions.length) return false
  S.actions = data.actions.map((a) => ({
    ...a,
    keys: Array.isArray(a.keys) && a.keys.length ? a.keys : [{ t: 0, values: {} }],
    params: Array.isArray(a.params) ? a.params : [],
    lines: Array.isArray(a.lines) ? a.lines.filter((x) => typeof x === 'string' && x.trim()) : [],
    duration: Math.max(100, Number(a.duration) || 1200),
  }))
  return true
}

async function saveAll() {
  const payload = { version: 1, actions: S.actions }
  let saved = false
  try {
    const r = await fetch('/api/actions', { method: 'PUT', headers: apiHeaders(true), body: JSON.stringify(payload) })
    saved = r.ok
  } catch { saved = false }
  // 没有壳层 / 服务不可用时的退路：留在浏览器本机，至少不丢这次的编辑
  if (!saved) { try { await window.shell?.actionsSave?.(payload); saved = true } catch {} }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)) } catch {}
  return saved
}

function scheduleSave() {
  clearTimeout(S.saveTimer)
  S.saveTimer = setTimeout(saveAll, 350)
}

async function bootData() {
  let data = null
  // 动作库归主进程管（userData/actions.json），编辑台只通过本地服务读写
  try {
    const r = await fetch('/api/actions', { headers: apiHeaders() })
    if (r.ok) data = await r.json()
  } catch {}
  if (!loadJSON(data)) {
    try { data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch {}
    loadJSON(data)
  }
  if (!S.actions.length) S.actions = [newAction('新动作')]
  // 旧版本会把内置预设整份抄进「我的动作」。护胯这条已经删掉了（物理链复现不出来），
  // 遗留副本顺手清掉，否则它会一直躺在列表里、点开还是错的。
  const before = S.actions.length
  S.actions = S.actions.filter((a) => a.id !== 'preset:pose:护胯' && a.name !== '护胯')
  if (S.actions.length !== before) scheduleSave()
  // 历史存档里的 preset 副本对齐当前预设：补 base/holds（手型基底）、补缺的参数。
  // 不修的话，早期装载过的「挥挥手 / 指人 / 杂鱼晃手」在预览里手永远是放下的。
  if (syncPresetCopies()) scheduleSave()
  S.cur = S.actions[0]
  const hint = $('#store-hint')
  if (hint) {
    hint.textContent = TOKEN
      ? '自动保存到 userData/actions.json · 舞台重启后生效'
      : '没拿到写入令牌：改动只保存在浏览器本机（从托盘/设置打开编辑台可写盘）'
  }
}

/* ───────────────────────── 动作库（融合验证台） ───────────────────────── */

async function bootLibrary() {
  S.lib.presets = allPresetActions()
  S.lib.motions = S.caps?.motions || []
  S.lib.exprs = S.caps?.expressions || []
  // 热区只活在舞台窗口里：能连上就拿几何 + 反应表，拿不到就空着（不挡编辑）
  let stageShape = 0
  try {
    const r = await fetch('/api/stage/regions', { method: 'POST', headers: apiHeaders(true), body: '{}' })
    if (r.ok) {
      const j = await r.json()
      if (j?.ok && Array.isArray(j.value)) S.lib.regions = j.value
    }
    const m = await fetch('/api/stage/meta', { method: 'POST', headers: apiHeaders(true), body: '{}' })
    if (m.ok) {
      const j = await m.json()
      stageShape = Number(j?.value?.bodyShape) || 0
      if (j?.value) S.stageMeta = j.value
    }
  } catch {}
  // 预览的体型要和舞台一致，否则热区（舞台按它的网格铺的）会和这边的小身体错位。
  // 体型是 Clothes2 参数，写完等两帧再按本预览的网格重铺身体段。
  if (stageShape > 0.001) {
    try {
      S.stage?.param.set('Clothes2', stageShape)
      await new Promise((r) => setTimeout(r, 180))
    } catch {}
  }
  localizeRegions()
  renderLibrary()
}

/**
 * 用**编辑台自己这一帧的网格**重铺身体段热区。
 *
 * 舞台传来的热区是按舞台体型/姿势铺的静态快照；编辑台预览是另一具实例，
 * 体型或姿势不同，矩形就会「框到空气里」。身体段（头/胸/腰/裙摆/腿/脚/胯/尾巴）
 * 这里就地重算；脸/手/长裙这些舞台特有热区保留（它们不在 seedRegions 的输出里）。
 */
function localizeRegions() {
  if (!S.stage?.core) return
  const byId = new Map((S.caps?.parts || []).map((p) => [p.id, p.name]))
  const displayNames = {
    get: (i) => { try { return byId.get(csmText(S.stage.core.getPartId(i))) || '' } catch { return '' } },
  }
  let fresh = []
  try {
    fresh = seedRegions({
      core: S.stage.core,
      internalModel: S.stage.model.internalModel,
      displayNames,
      canvas: S.stage.modelSize(),
    })
  } catch (e) { console.warn('[regions] 本地重铺失败', e); return }
  if (!fresh.length) return
  const map = new Map(fresh.map((r) => [r.name, r]))
  S.lib.regions = S.lib.regions.map((r) => {
    const f = map.get(r.name)
    return f ? { ...r, points: f.points, holes: f.holes || [], z: f.z } : r
  })
  for (const [name, f] of map) {
    if (!S.lib.regions.some((r) => r.name === name)) S.lib.regions.push({ ...f, reaction: {} })
  }
  drawRegions()
}

const libChips = (items, kind) => items.length
  ? items.map((n) => {
      const id = kind === 'idle' ? `preset:idle:${n}` : kind === 'pose' ? `preset:pose:${n}` : ''
      const loaded = !!id && S.actions.some((a) => a.id === id)
      return `<span class="chip-wrap"><button class="chip${loaded ? ' loaded' : ''}" data-kind="${kind}" data-name="${esc(n)}">${esc(n)}</button>${loaded ? `<button class="chip-del" data-del-id="${esc(id)}" title="从「我的动作」删除这份副本">×</button>` : ''}</span>`
    }).join('')
  : '<span class="empty">（无）</span>'

function renderLibrary() {
  const box = $('#lib')
  if (!box) return
  const idle = S.lib.presets.filter((p) => p.preset === 'idle' && !p.emotion).map((p) => p.name)
  const emotions = S.lib.presets.filter((p) => p.preset === 'idle' && p.emotion).map((p) => p.name)
  const poses = S.lib.presets.filter((p) => p.preset === 'pose').map((p) => p.name)
  const motions = S.lib.motions.map((m) => m.name)
  const exprs = S.lib.exprs.map((e) => e.name)
  const regions = S.lib.regions.map((r) => r.name)
  const group = (title, note, body) =>
    `<div class="lib-group"><h4>${title}<small>${note}</small></h4><div class="chips">${body}</div></div>`
  box.innerHTML = [
    group('内置待机', '点一下装载成关键帧', libChips(idle, 'idle')),
    group('情绪配方', '只该被点名，不进随机池', libChips(emotions, 'idle')),
    group('姿势', '手型 / 姿态终点', libChips(poses, 'pose')),
    group('官方动作', '原包 motion3，直接试播', libChips(motions, 'motion')),
    group('表情', '叠加预览，再点一次取消', libChips(exprs, 'expr')),
    group('热区', '点选高亮；点预览测命中', libChips(regions, 'region')),
  ].join('')
  for (const b of box.querySelectorAll('.chip[data-kind="expr"]')) {
    const on = S.exprsOn.has(b.dataset.name)
    b.classList.toggle('on', on || S.flash.has(b.dataset.name))
    b.classList.toggle('flash', !on && S.flash.has(b.dataset.name))
  }
}

function setSrc(src) {
  const onTab = src === 'on'
  S.src = onTab ? 'on' : 'acts'
  for (const b of document.querySelectorAll('#src-tabs button')) b.classList.toggle('on', b.dataset.src === S.src)
  $('#lib')?.classList.toggle('on', !onTab)
  $('#mine')?.classList.toggle('on', !onTab)
  $('#on')?.classList.toggle('on', onTab)
  if (onTab) renderEnabled()
}

/**
 * 把一条旧存档和「当前代码里的预设」对齐。
 *
 * 为什么需要：内置待机动作的手型是靠 `base`（姿势族基底）写进去的，这个字段是后加的；
 * 早期点「装载」存下来的副本没有 base/holds，于是「挥挥手」「指人」这些在预览里
 * **永远只是站着晃**，手根本不抬 —— 用户看到的就是「编辑台手部动作不能显示」。
 * 对齐只补这些结构性字段和缺的参数，用户自己改过的名称/配字/关键帧保留。
 */
function revivePreset(act, preset) {
  act.preset = preset.preset
  if (preset.base) act.base = JSON.parse(JSON.stringify(preset.base))
  else delete act.base
  if (preset.holds && Object.keys(preset.holds).length) act.holds = { ...preset.holds }
  else delete act.holds
  if (preset.emotion) act.emotion = true
  else delete act.emotion
  // 参数并集：旧副本可能少了手臂链那几个；缺的值从预设首帧补，不然写了也没值可用
  const have = new Set(act.params)
  const k0 = act.keys[0] || (act.keys[0] = { t: 0, values: {} })
  for (const id of preset.params) {
    if (have.has(id)) continue
    act.params.push(id)
    const v = preset.keys?.[0]?.values?.[id]
    if (v != null && k0.values[id] == null) k0.values[id] = v
  }
  return act
}

/** 启动时把所有 preset:xxx 存档对齐一遍（一次修好历史遗留的副本，不用逐个重新点） */
function syncPresetCopies() {
  const byId = new Map(allPresetActions().map((p) => [p.id, p]))
  let changed = 0
  for (const a of S.actions) {
    const p = byId.get(a.id)
    if (!p) continue
    const before = JSON.stringify([a.base, a.holds, a.params])
    revivePreset(a, p)
    if (JSON.stringify([a.base, a.holds, a.params]) !== before) changed += 1
  }
  return changed
}

/** 装载一个内置动作：已经载过就直接选中，没载过就复制一份进「我的动作」 */
function loadPreset(name) {
  const preset = S.lib.presets.find((p) => p.name === name)
  if (!preset) return
  let act = S.actions.find((a) => a.id === preset.id)
  if (!act) {
    act = JSON.parse(JSON.stringify(preset))
    S.actions.push(act)
    scheduleSave()
  } else {
    // 老副本：先按当前预设把 base/holds/缺口参数补齐，否则手型抬不起来
    revivePreset(act, preset)
    scheduleSave()
  }
  S.cur = act
  S.time = 0
  setPlaying(false)
  setSrc('acts')
  renderAll()
  toast(`已装载「${name}」：关键帧可改，物理输出走 holds`)
}

/**
 * 删除「我的动作」里的一份副本（内置动作本身不删；删掉后动作库里的 chip 会回到未装载态）。
 * 至少保留一个动作 —— 编辑台永远需要一个可编辑的当前动作。
 */
function removeAction(id) {
  const i = S.actions.findIndex((a) => a.id === id)
  if (i < 0) return
  if (S.actions.length <= 1) { toast('至少留一个动作'); return }
  const wasCur = S.cur?.id === id
  const name = S.actions[i].name
  S.actions.splice(i, 1)
  if (wasCur) { S.cur = S.actions[0]; S.time = 0; setPlaying(false) }
  scheduleSave()
  renderAll()
  toast(`已删除「${name}」的副本`)
}

/** 官方 motion3：直接交给引擎播（编辑台这侧的关键帧写入会临时让位） */
async function playMotion(name) {
  const m = S.lib.motions.find((x) => x.name === name)
  if (!m || !S.stage) { toast('这个动作播不了'); return }
  const idx = S.lib.motions.filter((x) => x.group === m.group).findIndex((x) => x.file === m.file)
  setPlaying(false)
  S.motionPlaying = true
  // 原包 motion3 里有 loop:true 的（IDLE 这类），onFinish 永远不回来 ——
  // 不兜底的话「官方动作播放中」会一直挂着，之后所有关键帧写入都被跳过。
  clearTimeout(playMotion._t)
  const ms = Math.max(600, Math.round((Number(m.duration) || 4) * 1000)) + 600
  playMotion._t = setTimeout(() => { S.motionPlaying = false; renderDiag() }, ms)
  try {
    await S.stage.motion(m.group, Math.max(0, idx), {
      loop: false,
      priority: MotionPriority.FORCE,
      onFinish: () => { clearTimeout(playMotion._t); S.motionPlaying = false; renderDiag() },
    })
  } catch (e) {
    clearTimeout(playMotion._t)
    S.motionPlaying = false
    toast(`播放失败：${e?.message || e}`)
  }
  toast(`试播官方动作「${name}」（${m.group || '动作组'}）`)
  renderDiag()
}

function toggleExpr(name) {
  if (S.exprsOn.has(name)) S.exprsOn.delete(name)
  else S.exprsOn.add(name)
  S.flash.delete(name)
  rebuildExprParams()
}

function rebuildExprParams() {
  const out = {}
  // 两层叠加：手动勾选（常驻）+ 热区触发的临时表情（到点自己撤）
  for (const name of new Set([...S.exprsOn, ...S.flash])) {
    const def = S.lib.exprs.find((e) => e.name === name)
    if (!def) continue
    for (const p of def?.params || []) out[p.Id] = p.Value
  }
  S.exprParams = out
  renderLibrary()
  renderEnabled()
}

/**
 * 临时表情：**整组替换**，不累加。
 * 以前是「把名字塞进 exprsOn + 存一份 prev 到时恢复」，连着点几个热区就会
 * 互相踩恢复时机，最后脸上挂着一堆（黑脸 + ＞＜ + 流泪 + 屑屑眼…），
 * 用户看到的就是「角色自己换表情」。现在临时层单独放，只有一组，到点清空。
 */
function flashExpressions(names, ms = 2600) {
  clearTimeout(S.flashTimer)
  if (!names?.length) {
    S.flash = new Set()
    rebuildExprParams()
    return
  }
  S.flash = new Set(names)
  rebuildExprParams()
  S.flashTimer = setTimeout(() => { S.flash = new Set(); rebuildExprParams() }, ms)
}

/* ───────────────────────── 互动实测（点 / 摸 → 反应表） ───────────────────────── */

/**
 * 在预览里演一遍「舞台会怎么反应」。
 * 编辑台以前只有热区高亮 —— 能看见命中谁，但看不到「摸一下会发生什么」，
 * 反应表对不对根本没法验证。这里直接照舞台的语义执行：
 *   toggle 型（表情开关）＝ 再点一次收回；expr 型 ＝ 临时叠加，到时自动撤。
 */
/**
 * 舞台里「不走反应表」的几个特殊热区（renderer 里是 if-else 硬编码的），
 * 编辑台照抄一份，否则点额头/长裙只会显示「未配置」，看着像坏了。
 */
function specialRegion(name, kind) {
  if (kind !== 'tap') return null
  if (name === '额头') {
    // 舞台：常态 → 爱心眼 → 黑框眼镜 三态循环
    const modes = ['爱心眼', '黑框眼镜', '']
    S.modeIdx = (S.modeIdx + 1) % modes.length
    const m = modes[S.modeIdx]
    return m ? { expr: [m], label: m } : { label: '常态' }
  }
  if (name === '长裙') {
    S.exprsOn.delete('裙子切换')
    S.flash.delete('裙子切换')
    rebuildExprParams()
    return { label: '换回短裙' }
  }
  return null
}

function applyReaction(region, kind = 'tap') {
  if (!region) { renderDiag(); return }
  const rx = region.reaction?.[kind] || specialRegion(region.name, kind) || null
  S.lastTouch = { region: region.name, kind, rx, at: performance.now() }
  if (rx?.toggle) {
    if (S.exprsOn.has(rx.toggle)) S.exprsOn.delete(rx.toggle)
    else S.exprsOn.add(rx.toggle)
    S.flash.delete(rx.toggle)
    rebuildExprParams()
  } else if (rx?.expr?.length) {
    flashExpressions(rx.expr, 2600)
  }
  renderDiag()
  renderEnabled()
}

const rxText = (rx) => {
  if (!rx) return '（未配置）'
  if (rx.label) return rx.label
  if (rx.toggle) return `切换「${rx.toggle}」`
  if (rx.expr?.length) return `表情「${rx.expr.join(' + ')}」`
  return JSON.stringify(rx)
}

function pickRegion(name) {
  S.selectedRegion = name
  S.showRegions = true
  const cb = $('#v-regions')
  if (cb) cb.checked = true
  drawRegions()
  const r = S.lib.regions.find((x) => x.name === name)
  // 点热区名 = 演一遍 tap 反应：反应表是「配了没用」还是「真的能用」，一眼就能验
  if (r) applyReaction(r, 'tap')
  const reacts = r?.reaction && Object.keys(r.reaction).length
    ? Object.entries(r.reaction).map(([k, v]) => `${k}→${rxText(v)}`).join(' · ')
    : '无反应'
  toast(`热区「${name}」· ${reacts}`)
  renderEnabled()
}

/* ───────────────────────── 启用列表（哪些东西真的在生效） ───────────────────────── */

const onLine = (k, v) => `<div class="dline"><b>${esc(k)}</b><span>${esc(v)}</span></div>`

function renderEnabled() {
  const pv = $('#on-preview')
  if (!pv) return
  const cur = S.cur
  const baseN = cur?.base ? Object.keys(cur.base).length : 0
  const holdN = cur?.holds ? Object.keys(cur.holds).length : 0
  const pool = (S.lib.presets || []).filter((p) => p.preset === 'idle' && !p.emotion)
  const emo = (S.lib.presets || []).filter((p) => p.preset === 'idle' && p.emotion)
  pv.innerHTML = [
    onLine('动作', cur ? `${cur.name}｜${cur.preset ? (cur.preset === 'pose' ? '姿势预设' : '待机预设') : '自建'}` : '无'),
    onLine('手型', baseN ? `姿势基底 ${baseN} 个参数` : '无 —— 手型抬不起来，重新装载预设即修复'),
    onLine('物理', holdN ? `holds ${holdN} 个（物理后写）` : '无'),
    onLine('表情', (() => {
      const manual = [...S.exprsOn]
      const temp = [...S.flash].filter((n) => !S.exprsOn.has(n))
      const txt = [manual.length ? `手动 ${manual.join('、')}` : '', temp.length ? `临时 ${temp.join('、')}` : ''].filter(Boolean).join(' ｜ ')
      return txt || '无叠加'
    })()),
    onLine('写入', `${S.written.size} 参数/帧${S.motionPlaying ? '（官方动作播放中，让位）' : ''}`),
    onLine('待机池', `${pool.length} 个：${pool.map((p) => p.name).join('、')}`),
    onLine('情绪', `${emo.length} 个（只被点名）：${emo.map((p) => p.name).join('、')}`),
  ].join('')
  const sub = $('#on-preview-sub')
  if (sub) sub.textContent = `时间 ${Math.round(S.time)}ms`

  const st = S.stageMeta
  const stageBox = $('#on-stage')
  if (stageBox) {
    if (!st) {
      stageBox.innerHTML = '<div class="dline"><b>舞台</b><span>连不上舞台（编辑台可以在舞台关着时单开）</span></div>'
    } else {
      const a = st.active || {}
      const idleNow = a.idle?.current ? `正在演「${a.idle.current}」` : `空闲（${a.idle?.nextIn ?? '?'}s 后下一段）`
      stageBox.innerHTML = [
        onLine('姿势', `${a.pose || '默认手'}${a.hands ? `｜手 ${a.hands.left || '放下'} / ${a.hands.right || '放下'}` : ''}`),
        onLine('表情', (a.exprs || []).length ? a.exprs.join('、') : '无'),
        onLine('待机', idleNow),
        onLine('小表情', `${a.randomFaces === false ? '关' : '开'}${a.faceNow?.current ? `（正在演「${a.faceNow.current}」）` : ''}`),
        onLine('裙', a.skirt === 'long' ? '长裙' : '短裙'),
        onLine('热区', `${(st.regions || []).length} 个 · 体型 ${Number(st.bodyShape || 0).toFixed(2)}`),
      ].join('')
    }
    const sub2 = $('#on-stage-sub')
    if (sub2) sub2.textContent = st ? '快照' : '离线'
  }

  const rxBox = $('#on-reactions')
  if (rxBox) {
    const rows = (S.lib.regions || []).filter((r) => r.name)
    rxBox.innerHTML = rows.length
      ? rows.map((r) => `<div class="dline"><b>${esc(r.name)}</b><span>点→${esc(rxText(r.reaction?.tap))}　摸→${esc(rxText(r.reaction?.pet))}</span></div>`).join('')
      : '<div class="dline"><b>热区</b><span>没拿到（舞台关着时拿不到几何）</span></div>'
  }
}

async function refreshStageMeta() {
  try {
    const m = await fetch('/api/stage/meta', { method: 'POST', headers: apiHeaders(true), body: '{}' })
    if (m.ok) {
      const j = await m.json()
      if (j?.value) S.stageMeta = j.value
    }
  } catch {}
  // 顺手把热区反应表也拉一次：舞台那边可能刚改过反应
  try {
    const r = await fetch('/api/stage/regions', { method: 'POST', headers: apiHeaders(true), body: '{}' })
    if (r.ok) {
      const j = await r.json()
      if (j?.ok && Array.isArray(j.value)) {
        S.lib.regions = S.lib.regions.map((x) => {
          const f = j.value.find((y) => y.name === x.name)
          return f ? { ...x, reaction: f.reaction || x.reaction } : x
        })
      }
    }
  } catch {}
  renderEnabled()
  renderDiag()
}

/* ── 热区几何：模型坐标 → 屏幕（和舞台的换算式一致） ── */

let overlay = null
function ensureOverlay() {
  if (overlay?.isConnected) return overlay
  const box = $('#preview')
  if (!box) return null
  overlay = document.createElement('canvas')
  overlay.id = 'region-overlay'
  box.appendChild(overlay)
  return overlay
}

function modelToClient(x, y) {
  const st = S.stage
  if (!st) return { x: 0, y: 0 }
  const cr = st.canvas.getBoundingClientRect()
  const sc = st.model.scale.x
  const ms = st.modelSize()
  return {
    x: cr.left + st.model.position.x + (x - ms.width / 2) * sc,
    y: cr.top + st.model.position.y + (y - ms.height / 2) * sc,
  }
}

function drawRegions() {
  const cv = ensureOverlay()
  if (!cv) return
  const st = S.stage
  const box = $('#preview')
  if (!st || !box) return
  const rect = box.getBoundingClientRect()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const W = Math.max(1, Math.round(rect.width * dpr))
  const H = Math.max(1, Math.round(rect.height * dpr))
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
  const ctx = cv.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  if (!S.showRegions || !S.lib.regions.length) return
  for (const r of S.lib.regions) {
    if (!r.points?.length) continue
    const picked = S.selectedRegion === r.name
    ctx.beginPath()
    r.points.forEach(([x, y], i) => {
      const p = modelToClient(x, y)
      const px = p.x - rect.left
      const py = p.y - rect.top
      if (i) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    })
    ctx.closePath()
    ctx.strokeStyle = picked ? 'rgba(91,157,255,.95)' : 'rgba(120,160,220,.5)'
    ctx.lineWidth = picked ? 2 : 1
    ctx.fillStyle = picked ? 'rgba(91,157,255,.16)' : 'rgba(120,160,220,.05)'
    ctx.fill()
    ctx.stroke()
    if (picked) {
      const p0 = modelToClient(r.points[0][0], r.points[0][1])
      ctx.fillStyle = 'rgba(91,157,255,.95)'
      ctx.font = '11px system-ui'
      ctx.fillText(r.name, p0.x - rect.left + 4, p0.y - rect.top - 4)
    }
  }
}

function regionAtClient(x, y) {
  if (!S.viewport || !S.lib.regions.length) return null
  const p = S.viewport.clientToModel(x, y)
  const hits = S.lib.regions.filter((r) => r.points?.length && pointInPolygon(p.x, p.y, r.points))
  hits.sort((a, b) => (b.z || 0) - (a.z || 0))
  return hits[0] || null
}

function renderDiag() {
  const box = $('#diag')
  if (!box) return
  const ph = S.stage?.physicsInfo?.()
  const held = Object.entries(S.cur?.holds || {})
  const mode = S.motionPlaying ? '官方动作播放中' : S.playing ? '播放中' : '暂停'
  const takesHead = actionTakesHead(S.cur)
  const trackNote = !S.interact ? '' : takesHead ? ' · 交互开（动作接管头部，追踪暂停）' : ' · 交互开'
  const touch = S.lastTouch
  box.innerHTML = `
    <div class="dline"><b>物理</b><span>${ph?.attached ? '已挂' : '未挂'} · 评估 ${ph?.evals ?? 0} 次</span></div>
    <div class="dline"><b>状态</b><span>${mode}${trackNote}</span></div>
    <div class="dline"><b>命中</b><span>${S.hit ? esc(S.hit.name) : '（在预览里点一下）'}</span></div>
    <div class="dline"><b>最近</b><span>${touch ? `${esc(touch.region)} · ${touch.kind === 'tap' ? '点' : '摸'} → ${esc(rxText(touch.rx))}` : '还没互动过'}</span></div>
    <div class="dline"><b>受控</b><span>${held.length ? esc(held.map(([k, v]) => `${k}=${v}`).join(' · ')) : '无（物理输出参数写在这里）'}</span></div>`
  const sub = $('#diag-sub')
  if (sub) sub.textContent = `${S.lib.regions.length} 热区`
}


/* ───────────────────────── 渲染 ───────────────────────── */

function renderList() {
  const ul = $('#act-list')
  ul.innerHTML = S.actions.map((a) => `
    <li data-id="${esc(a.id)}" class="${a === S.cur ? 'on' : ''}">
      <span>${esc(a.name || '未命名')}</span><small>${Math.round(a.duration)}ms</small>
    </li>`).join('')
}

let fieldsFor = null

function renderFields() {
  const a = S.cur
  if (!a) return
  const nameEl = $('#act-name')
  const durEl = $('#act-dur')
  const linesEl = $('#act-lines')
  // 切到别的动作时强制刷新（输入框可能还端着焦点，否则会显示上一个动作的配字）
  const force = fieldsFor !== a
  fieldsFor = a
  if (force || document.activeElement !== nameEl) nameEl.value = a.name || ''
  if (force || document.activeElement !== durEl) durEl.value = String(Math.round(a.duration))
  if (force || document.activeElement !== linesEl) linesEl.value = (a.lines || []).join('\n')
}

/* 试播台词气泡：播放时随机出一句，跟动作一起看效果 */
function showRandomLine() {
  const el = $('#line-bubble')
  const lines = S.cur?.lines || []
  if (!lines.length) { el.classList.remove('on'); return }
  el.textContent = lines[Math.floor(Math.random() * lines.length)]
  el.classList.add('on')
}
function hideLine() {
  $('#line-bubble').classList.remove('on')
}

function renderTimeline() {
  const a = S.cur
  if (!a) return
  const dur = Math.max(100, Math.round(a.duration))
  S.time = clamp(S.time, 0, dur)
  $('#time').max = String(dur)
  $('#time').value = String(S.time)
  $('#time-readout').textContent = `${Math.round(S.time)} / ${dur} ms`
  $('#keys').innerHTML = a.keys
    .slice()
    .sort((x, y) => x.t - y.t)
    .map((k) => `<button data-t="${k.t}" class="${Math.abs(k.t - S.time) < 1 ? 'on' : ''}">${k.t}ms</button>`)
    .join('')
  const hasKey = Math.abs((keyAt(a, S.time)?.t ?? -999) - S.time) < 1
  const tag = $('#key-state')
  tag.textContent = hasKey ? '当前是关键帧' : '当前不是关键帧（拖参数会自动建）'
  tag.classList.toggle('on', hasKey)
}

function renderParams() {
  const q = ($('#param-search').value || '').trim().toLowerCase()
  const all = S.caps?.params || []
  // 搜索也认中文别名：「前倾」能找到 LeanInput、「换手」能找到 Param56/57
  const list = all.filter((p) => !q || haystackOf(p).includes(q))
  const used = new Set(S.cur?.params || [])
  $('#param-count').textContent = q ? `${list.length}/${all.length}` : `${all.length} 个`
  $('#param-list').innerHTML = list.slice(0, 500).map((p) => {
    const alias = aliasOf(p.id)
    return `
    <li data-id="${esc(p.id)}" class="${used.has(p.id) ? 'on' : ''}">
      <span>${esc(p.name)}${alias ? `<em>${esc(alias)}</em>` : ''}</span><small>${esc(p.id)}</small>
    </li>`
  }).join('')
  renderActiveParams()
}

function renderActiveParams() {
  const box = $('#param-active')
  const cur = S.cur
  const ids = cur?.params || []
  if (!ids.length) {
    box.innerHTML = '<div class="empty">还没有参数：在下面列表点一个</div>'
    return
  }
  box.innerHTML = ids.map((id) => {
    const info = infoOf(id)
    const v = valueAt(cur, id, S.time) ?? info.default ?? 0
    const def = S.caps?.params.find((p) => p.id === id)
    const name = def?.name || id
    const alias = aliasOf(id)
    const step = (info.max - info.min) / 1000 || 0.001
    return `<div class="pa" data-id="${esc(id)}">
      <div class="top">
        <b title="${esc(id)}">${esc(name)}${alias ? `<em>${esc(alias)}</em>` : ''}<small>${esc(id)}</small></b>
        <input class="num" type="number" data-num="${esc(id)}" min="${info.min}" max="${info.max}" step="any" value="${Number(v).toFixed(3)}">
      </div>
      <div class="bar">
        <input type="range" min="${info.min}" max="${info.max}" step="${step}" value="${v}">
        <button data-del="${esc(id)}" title="从本动作移除这个参数">×</button>
      </div>
    </div>`
  }).join('')
}

function renderAll() {
  renderList()
  renderLibrary()
  renderFields()
  renderTimeline()
  renderParams()
  renderView()
  renderDiag()
  renderEnabled()
}

/* ───────────────────────── 播放 ───────────────────────── */

function tick(now) {
  if (!S.playing || !S.cur) return
  const dt = tick.last ? now - tick.last : 16
  tick.last = now
  S.time += dt * (S.speed || 1)
  const dur = Math.max(100, Math.round(S.cur.duration))
  if (S.time > dur) { S.time = 0; showRandomLine() }
  $('#time').value = String(S.time)
  $('#time-readout').textContent = `${Math.round(S.time)} / ${dur} ms`
  const hasKey = Math.abs((keyAt(S.cur, S.time)?.t ?? -999) - S.time) < 1
  if (hasKey) renderTimeline()
  S.rafId = requestAnimationFrame(tick)
}

function setPlaying(on) {
  S.playing = !!on
  $('#play').textContent = S.playing ? '⏸ 暂停' : '▶ 播放'
  if (S.playing) {
    // 关键帧播放接管：把官方 motion3 停掉，别让它继续压参数
    clearTimeout(playMotion._t)
    S.motionPlaying = false
    try { S.stage?.stopMotions?.() } catch {}
    tick.last = 0
    showRandomLine()
    S.rafId = requestAnimationFrame(tick)
  } else {
    cancelAnimationFrame(S.rafId)
    hideLine()
    renderTimeline()
    renderActiveParams()
  }
}

/* ───────────────────────── 事件绑定 ───────────────────────── */

function bindView() {
  const apply = (patch, extra = {}) => {
    setView(patch, extra)
    // 正在拖动参数滑块时不要重渲染右栏（会打断输入焦点）
    if (S.playing) return
    renderActiveParams()
  }
  $('#v-zoom').oninput = (e) => apply({ zoom: Number(e.target.value) })
  $('#v-x').oninput = (e) => apply({ offsetX: Number(e.target.value) })
  $('#v-y').oninput = (e) => apply({ offsetY: Number(e.target.value) })
  $('#v-reset').onclick = () => {
    apply({ zoom: 1, offsetX: 0, offsetY: 0 })
    toast('预览已复位')
  }

  // 中键拖动 = 平移预览；左键 = 点击/交互（Alt+左键拖动 = 转头）
  // 绑在 #stage-wrap 而不是 #preview：放大后模型会溢出到整个中栏，只绑画布会出现「拖到边上就抓不住」
  const wrap = $('#stage-wrap')
  let drag = null
  wrap.addEventListener('pointerdown', (e) => {
    // 工具条 / 时间轴上的控件不参与平移，否则拖滑杆会把画面一起带走
    if (e.target.closest?.('button, input, textarea, select, label, #viewbar, #timeline')) return
    const rect = wrap.getBoundingClientRect()
    if (e.button === 1) {
      // 中键：平移。preventDefault 挡掉浏览器的「中键自动滚动」
      e.preventDefault()
      drag = { mode: 'pan', x: e.clientX, y: e.clientY, ox: S.view.offsetX, oy: S.view.offsetY, w: rect.width || 1, h: rect.height || 1 }
      wrap.classList.add('panning')
      try { wrap.setPointerCapture?.(e.pointerId) } catch {}
      hintOnce()
      return
    }
    if (e.button !== 0) return
    if (e.altKey) {
      // Alt+拖动 = 手动转头：横向/纵向位置映射成视线，松手也不回弹（方便对准某个角度截图）
      drag = { mode: 'look', x: e.clientX, y: e.clientY, gx: S.gaze.x, gy: S.gaze.y, w: rect.width || 1, h: rect.height || 1 }
      S.interact = true
      const cb = $('#v-interact')
      if (cb) cb.checked = true
    } else {
      // 左键：只做点击/交互。拖动不再平移 —— 以前左键拖会把画面带走，热区根本点不准
      drag = { mode: 'tap', x: e.clientX, y: e.clientY, moved: false }
      S.petRegion = null   // 新的一次按住：抚摸每块热区只触发一次反应
    }
    wrap.classList.add('dragging')
    try { wrap.setPointerCapture?.(e.pointerId) } catch {}
    hintOnce()
  })
  // 中键自动滚动：浏览器默认行为，必须单独挡掉（pointerdown 的 preventDefault 不一定够）
  wrap.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault() })
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return
    if (drag.mode === 'look' || drag.mode === 'pan') {
      const dx = (e.clientX - drag.x) / (drag.w || 1) * 2
      const dy = (e.clientY - drag.y) / (drag.h || 1) * 2
      if (drag.mode === 'look') {
        S.gaze.x = clamp(drag.gx + dx * 1.4, -1, 1)
        S.gaze.y = clamp(drag.gy + dy * 1.4, -1, 1)
      } else {
        setView({ offsetX: drag.ox + dx, offsetY: drag.oy + dy }, { silent: true })
      }
      return
    }
    // tap：只记录有没有拖动，松手时决定算不算「点一下」
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) drag.moved = true
    // 按住滑动 = 抚摸：按舞台的语义「摸到哪块热区就触发哪块的 pet 反应」，
    // 一次按住只触发一次（连续抚摸在舞台里是分步的，编辑台验反应表够用）。
    if (drag.moved) {
      const r = regionAtClient(e.clientX, e.clientY)
      if (r && S.petRegion !== r.name) {
        S.petRegion = r.name
        S.hit = r
        applyReaction(r, 'pet')
      }
    }
  })
  const endDrag = (e) => {
    if (!drag) return
    const tap = drag.mode === 'tap' && !drag.moved
    drag = null
    wrap.classList.remove('dragging', 'panning')
    try { wrap.releasePointerCapture?.(e.pointerId) } catch {}
    renderActiveParams()
    // 左键点一下 = 热区命中测试：这就是验证台的「点哪里命中谁」
    if (tap && e?.clientX != null) {
      const r = regionAtClient(e.clientX, e.clientY)
      S.hit = r
      if (r) {
        S.selectedRegion = r.name
        drawRegions()
      }
      // 点一下就演一遍这块热区的 tap 反应（切换型表情会真的开/关），不是只画个框
      applyReaction(r, 'tap')
    }
  }
  wrap.addEventListener('pointerup', endDrag)
  wrap.addEventListener('pointercancel', endDrag)
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault()
    const vp = S.viewport
    const before = vp?.clientToModel?.(e.clientX, e.clientY)
    const k = Math.exp(-e.deltaY * 0.0012)
    setView({ zoom: S.view.zoom * k }, { silent: true })
    if (!before || !vp) return
    // 缩放锚在光标：解一次 offset，让光标下的那个模型点待在原地（不然放大总是往左上跑）
    const after = vp.clientToModel(e.clientX, e.clientY)
    const s = Math.abs(S.stage?.model?.scale?.x || 1)
    const { w, h } = vp.size()
    setView({
      offsetX: S.view.offsetX + ((after.x - before.x) * s * 2) / (w || 1),
      offsetY: S.view.offsetY + ((after.y - before.y) * s * 2) / (h || 1),
    }, { silent: true })
  }, { passive: false })
  wrap.addEventListener('dblclick', () => {
    setView({ zoom: 1, offsetX: 0, offsetY: 0 })
    toast('已复位')
  })

  // 交互：鼠标在预览上移动 → 视线/头部跟随（和舞台同一个观感）
  wrap.addEventListener('pointermove', (e) => {
    if (!S.interact || drag) return
    const box = $('#preview').getBoundingClientRect()
    S.gaze.x = clamp(((e.clientX - box.left) / box.width) * 2 - 1, -1, 1)
    S.gaze.y = clamp(((e.clientY - box.top) / box.height) * 2 - 1, -1, 1)
  })
  wrap.addEventListener('pointerleave', () => {
    if (!S.interact) return
    S.gaze.x = 0
    S.gaze.y = 0
  })
  const interactEl = $('#v-interact')
  if (interactEl) {
    interactEl.onchange = (e) => {
      S.interact = !!e.target.checked
      if (!S.interact) { S.gaze.x = 0; S.gaze.y = 0 }
      renderDiag()
    }
  }
  const regionsEl = $('#v-regions')
  if (regionsEl) {
    regionsEl.onchange = (e) => { S.showRegions = !!e.target.checked; drawRegions() }
  }
  try { new ResizeObserver(() => drawRegions()).observe($('#preview')) } catch {}
}

function bindUi() {
  // ---- 左栏标签：动作库 / 我的动作 ----
  $('#src-tabs').onclick = (e) => {
    const b = e.target.closest('button')
    if (b) setSrc(b.dataset.src)
  }
  // ---- 动作库：装载 / 选中 / 删除副本 / 试播 / 表情叠加 / 热区高亮 ----
  $('#lib').onclick = (e) => {
    const del = e.target.closest('.chip-del')
    if (del) { removeAction(del.dataset.delId); return }
    const b = e.target.closest('.chip')
    if (!b) return
    const { kind, name } = b.dataset
    if (kind === 'idle' || kind === 'pose') {
      // 已装载过就直接选中那份副本（可改名/删/编辑），没载过才复制一份
      const id = kind === 'idle' ? `preset:idle:${name}` : `preset:pose:${name}`
      const exist = S.actions.find((a) => a.id === id)
      if (exist) {
        S.cur = exist
        S.time = 0
        setPlaying(false)
        renderAll()
      } else loadPreset(name)
    }
    else if (kind === 'motion') playMotion(name)
    else if (kind === 'expr') toggleExpr(name)
    else if (kind === 'region') pickRegion(name)
  }
  // ---- 启用：舞台状态刷新 + 热区反应表演 ----
  const onRefresh = $('#on-refresh')
  if (onRefresh) onRefresh.onclick = () => refreshStageMeta()
  const onRx = $('#on-reactions')
  if (onRx) onRx.onclick = (e) => {
    const b = e.target.closest('.dline')
    if (!b) return
    const name = b.querySelector('b')?.textContent?.trim()
    if (name && S.lib.regions.some((r) => r.name === name)) pickRegion(name)
  }
  // ---- 左栏：动作 ----
  $('#act-list').onclick = (e) => {
    const li = e.target.closest('li')
    if (!li) return
    const a = S.actions.find((x) => x.id === li.dataset.id)
    if (!a || a === S.cur) return
    S.cur = a
    S.time = 0
    setPlaying(false)
    renderAll()
  }
  $('#act-name').oninput = (e) => {
    if (!S.cur) return
    S.cur.name = e.target.value
    scheduleSave()
    renderList()
  }
  $('#act-dur').onchange = (e) => {
    if (!S.cur) return
    S.cur.duration = Math.max(100, Math.round(Number(e.target.value) || 1200))
    scheduleSave()
    renderTimeline()
  }
  // 配字：一行一句，播放时随机抽一句显示在预览气泡里
  $('#act-lines').oninput = (e) => {
    if (!S.cur) return
    S.cur.lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)
    scheduleSave()
  }
  $('#act-new').onclick = () => {
    const a = newAction(`动作 ${S.actions.length + 1}`)
    S.actions.push(a)
    S.cur = a
    S.time = 0
    setPlaying(false)
    scheduleSave()
    renderAll()
  }
  $('#act-dup').onclick = () => {
    if (!S.cur) return
    const a = JSON.parse(JSON.stringify(S.cur))
    a.id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    a.name = `${S.cur.name} 副本`
    S.actions.push(a)
    S.cur = a
    scheduleSave()
    renderAll()
  }
  $('#act-del').onclick = () => {
    if (S.actions.length <= 1) { toast('至少留一个动作'); return }
    S.actions = S.actions.filter((a) => a !== S.cur)
    S.cur = S.actions[0]
    S.time = 0
    scheduleSave()
    renderAll()
  }
  $('#act-save').onclick = async () => {
    clearTimeout(S.saveTimer)
    await saveAll()
    toast(`已保存：${S.actions.length} 个动作`)
  }
  $('#act-export').onclick = () => {
    const blob = new Blob([JSON.stringify({ version: 1, actions: S.actions }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'live2d-actions.json'
    a.click()
    URL.revokeObjectURL(a.href)
    toast('已导出 live2d-actions.json')
  }
  $('#act-import').onchange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      if (!loadJSON(data)) { toast('这个 JSON 里没有 actions 数组'); return }
      S.cur = S.actions[0]
      S.time = 0
      await saveAll()
      renderAll()
      toast(`导入成功：${S.actions.length} 个动作`)
    } catch { toast('JSON 读不了') }
    e.target.value = ''
  }

  // ---- 时间轴 ----
  $('#play').onclick = () => setPlaying(!S.playing)
  // 预览速度：上限 1.0（预设速度）。手/裙子的贴图切换由动作本身的关键帧决定，不受这里影响。
  const speedEl = $('#speed')
  const speedOut = $('#speed-readout')
  if (speedEl) {
    speedEl.value = String(S.speed)
    speedEl.oninput = (e) => {
      S.speed = Math.max(0.5, Math.min(1, Number(e.target.value) || 1))
      if (speedOut) speedOut.textContent = `${S.speed.toFixed(2)}×`
    }
    if (speedOut) speedOut.textContent = `${S.speed.toFixed(2)}×`
  }
  $('#time').oninput = (e) => {
    S.time = Number(e.target.value) || 0
    setPlaying(false)
    renderTimeline()
    renderActiveParams()
  }
  $('#keys').onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    S.time = Number(b.dataset.t) || 0
    setPlaying(false)
    renderTimeline()
    renderActiveParams()
  }
  $('#add-key').onclick = () => {
    if (!S.cur) return
    const k = ensureKey(S.cur, S.time)
    for (const id of S.cur.params) {
      if (k.values[id] == null) k.values[id] = valueAt(S.cur, id, S.time) ?? infoOf(id).default ?? 0
    }
    scheduleSave()
    renderTimeline()
    toast(`已在 ${Math.round(S.time)}ms 建关键帧`)
  }
  $('#del-key').onclick = () => {
    if (!S.cur) return
    const before = S.cur.keys.length
    S.cur.keys = S.cur.keys.filter((k) => Math.abs(k.t - S.time) > 0.5)
    if (!S.cur.keys.length) S.cur.keys = [{ t: 0, values: {} }]
    if (S.cur.keys.length === before) { toast('这个时间点没有关键帧'); return }
    scheduleSave()
    renderTimeline()
    renderActiveParams()
    toast('已删除关键帧')
  }

  // ---- 关键帧复制 / 粘贴（做循环动作不用一个个拖滑块）----
  const snapshotValues = (a, t) => {
    const out = {}
    for (const id of a.params) { const v = valueAt(a, id, t); if (v != null) out[id] = v }
    return out
  }
  $('#copy-key').onclick = () => {
    if (!S.cur) return
    const k = keyAt(S.cur, S.time)
    S.clip = k ? { ...k.values } : snapshotValues(S.cur, S.time)
    const n = Object.keys(S.clip || {}).length
    toast(n ? `已复制 ${Math.round(S.time)}ms 的 ${n} 个参数` : '这一帧没有可复制的值')
  }
  $('#paste-key').onclick = () => {
    if (!S.cur || !S.clip) { toast('先复制一帧再粘贴'); return }
    const k = ensureKey(S.cur, S.time)
    for (const [id, v] of Object.entries(S.clip)) {
      if (!S.cur.params.includes(id)) S.cur.params.push(id)
      k.values[id] = v
    }
    scheduleSave()
    renderAll()
    toast(`已粘贴到 ${Math.round(S.time)}ms`)
  }

  $('#param-search').oninput = () => renderParams()
  $('#param-list').onclick = (e) => {
    const li = e.target.closest('li')
    if (!li || !S.cur) return
    const id = li.dataset.id
    if (S.cur.params.includes(id)) {
      S.cur.params = S.cur.params.filter((x) => x !== id)
      for (const k of S.cur.keys) delete k.values[id]
    } else {
      S.cur.params.push(id)
      // 立刻在当前时间落一个值，避免加进来是空的
      const k = ensureKey(S.cur, S.time)
      if (k.values[id] == null) k.values[id] = infoOf(id).default ?? 0
    }
    scheduleSave()
    renderAll()
  }
  $('#param-active').oninput = (e) => {
    if (!S.cur) return
    const wrap = e.target.closest('.pa')
    if (!wrap) return
    const id = wrap.dataset.id
    // 数值框：边输边写（不重新渲染，免得打断输入）
    if (e.target.classList.contains('num')) {
      const val = Number(e.target.value)
      if (!Number.isFinite(val)) return
      const info = infoOf(id)
      const v = clamp(val, info.min, info.max)
      const k = ensureKey(S.cur, S.time)
      k.values[id] = v
      const r = wrap.querySelector('input[type=range]')
      if (r) r.value = String(v)
      try { S.stage.param.set(id, v) } catch {}
      scheduleSave()
      return
    }
    if (e.target.type !== 'range') return
    const val = Number(e.target.value)
    // 拖动 = 当前时间的关键帧值；没有就自动建，所见即所得
    const k = ensureKey(S.cur, S.time)
    k.values[id] = val
    const num = wrap.querySelector('.num')
    if (num && document.activeElement !== num) num.value = val.toFixed(3)
    try { S.stage.param.set(id, val) } catch {}
    scheduleSave()
    if (!keyAt(S.cur, S.time)) renderTimeline()
  }
  // 数值框确认（回车/失焦）：夹回量程并规范到 3 位小数
  $('#param-active').onchange = (e) => {
    if (!e.target.classList.contains('num') || !S.cur) return
    const wrap = e.target.closest('.pa')
    if (!wrap) return
    const id = wrap.dataset.id
    const info = infoOf(id)
    const v = clamp(Number(e.target.value) || 0, info.min, info.max)
    const k = ensureKey(S.cur, S.time)
    k.values[id] = v
    e.target.value = v.toFixed(3)
    const r = wrap.querySelector('input[type=range]')
    if (r) r.value = String(v)
    try { S.stage.param.set(id, v) } catch {}
    scheduleSave()
  }
  // 点进数值框自动全选，直接打新值就能覆盖
  $('#param-active').onfocusin = (e) => {
    if (e.target.classList?.contains('num')) e.target.select()
  }
  $('#param-active').onclick = (e) => {
    const b = e.target.closest('button[data-del]')
    if (!b || !S.cur) return
    const id = b.dataset.del
    S.cur.params = S.cur.params.filter((x) => x !== id)
    for (const k of S.cur.keys) delete k.values[id]
    scheduleSave()
    renderAll()
  }

  // ---- 快捷键 ----
  window.addEventListener('keydown', (e) => {
    const el = e.target
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
    if (typing) return
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!S.playing) }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); $('#del-key').click() }
    if (e.code === 'KeyK') { e.preventDefault(); $('#add-key').click() }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') { e.preventDefault(); $('#copy-key').click() }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') { e.preventDefault(); $('#paste-key').click() }
  })
}

/* ───────────────────────── 启动 ───────────────────────── */

async function main() {
  // 主题先落地（首帧别闪），再做耗时的模型/动作加载
  await initTheme()
  mountThemeSwitch($('#theme-switch'))
  S.caps = await fetch('/api/capabilities').then((r) => r.json())
  loadView()
  await bootData()
  await bootPreview()
  await bootLibrary()
  bindView()
  bindUi()
  setSrc('acts')
  renderAll()
  drawRegions()
  // 诊断面板低频刷新（物理评估次数 / 播放状态这类会自己变）
  setInterval(() => { if (!document.hidden) renderDiag() }, 800)
}

main().catch((e) => {
  document.body.innerHTML = `<pre style="padding:16px;color:#f88">编辑器启动失败：${esc(e.message)}\n\n${esc(e.stack || '')}</pre>`
  console.error(e)
})

// 开发期探针（无头验证用）
window.__editor = {
  get stage() { return S.stage },
  get cur() { return S.cur },
  get time() { return S.time },
  get view() { return { ...S.view } },
  /** 写入链路状态：motionPlaying 挡住写参数时，预览会「参数不动」但看着像别的原因 */
  state: () => ({
    motionPlaying: S.motionPlaying,
    playing: S.playing,
    interact: S.interact,
    exprs: [...S.exprsOn],        // 手动勾选的常驻表情
    flash: [...S.flash],          // 热区触发的临时表情（到点自动撤）
    written: S.written.size,
  }),
  hit: () => S.hit,
  exprs: () => [...S.exprsOn],
  regions: () => S.lib.regions,
  bodyShape: () => { try { return Number(S.stage?.param?.get('Clothes2')) || 0 } catch { return null } },
  setTime(t) { S.time = Number(t) || 0; renderTimeline(); renderActiveParams() },
  setView(patch) { setView(patch) },
  valueAt: (id, t) => valueAt(S.cur, id, t ?? S.time),
  readAtUpdate(id) {
    return new Promise((resolve) => {
      const off = S.stage.onBeforeUpdate(() => { off?.(); resolve(S.stage.param.get(id)) })
    })
  },
}
