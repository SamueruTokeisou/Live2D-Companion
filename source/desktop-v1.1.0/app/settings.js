// 设置窗口。
//
// 分工：
//   - 纯设置项（尺寸/缩放/跟随/气泡/置顶/穿透）走 shell.set → 主进程存盘并广播 → 覆盖层立即生效；
//     设置窗口自己不持有任何状态，也不直接碰模型。
//   - 需要舞台内部状态的（热区反应表、导出补丁）走 shell.stageRpc，舞台窗口是唯一真相。
import { initTheme, mountThemeSwitch } from './theme.js'

const $ = (s) => document.querySelector(s)

const shell = window.shell || {
  get: async () => ({}),
  set: async (p) => p,
  stageRpc: async () => ({ ok: false, error: 'no bridge' }),
  center: () => {},
  openEditor: () => {},
  openHarness: () => {},
  quit: () => {},
}

let settings = {}

function status(text, warn = false) {
  const el = $('#status')
  if (!el) return
  el.textContent = text || ''
  el.classList.toggle('warn', !!warn)
  clearTimeout(status._t)
  if (text) status._t = setTimeout(() => { el.textContent = '' }, 3600)
}

async function rpc(op, payload) {
  const r = await shell.stageRpc?.(op, payload)
  if (!r || r.ok === false) {
    status(r?.error || '舞台窗口没响应，先把角色启动起来', true)
    return null
  }
  return r.value
}

/** 滑块连续拖动时别每帧写盘：攒 120ms 发一次 */
function debounce(fn, ms = 120) {
  let t = 0
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

const pushSettings = (patch) => shell.set(patch)
const pushSettingsSoon = debounce((patch) => shell.set(patch))

function paint() {
  $('#target-fps').value = settings.targetFps === 60 ? '60' : '30'
  if (settings.profileMode === 'generic') {
    for (const id of ['body-shape','random-faces','pet-gain','action-speed','idle-speed','head-gain','native-core','engine-select']) { const el = document.getElementById(id); if (el) el.disabled = true }
  }
  setRange('#strength', Number(settings.strength ?? 1))
  const headGain = Number(settings.headGain ?? 1.25)
  setRange('#head-gain', headGain)
  showHeadGain(headGain)
  setRange('#pet-gain', Number(settings.petGain ?? 1.6))
  setRange('#idle-speed', Number(settings.idleSpeed ?? 1))
  showIdleSpeed(Number(settings.idleSpeed ?? 1))
  const actSpeed = Number(settings.actionSpeed ?? 0.8)
  setRange('#action-speed', actSpeed)
  showActionSpeed(actSpeed)

  setCheck('#gaze', settings.gaze !== false)
  setCheck('#idle', settings.idle !== false)
  setCheck('#random-faces', settings.randomFaces !== false)
  setCheck('#bubble-on', settings.bubble !== false)
  setCheck('#border', !!settings.border)
  const padY = Number(settings.padY ?? 0.02)
  setRange('#pad-y', padY)
  $('#pad-y-readout').textContent = `${Math.round(padY * 100)}%`
  const body = Number(settings.bodyShape ?? 0)
  setRange('#body-shape', body)
  $('#body-shape-readout').textContent = body <= 0.01 ? '默认' : body >= 0.99 ? '体型2' : '体型 ' + Math.round(body * 100) + '%'
  setCheck('#drag-physics', settings.dragPhysics !== false)
  setCheck('#update-check', settings.updateCheck !== false)
  setCheck('#native-core', settings.nativeCore === true)
  $('#engine-select').value = settings.engine === 'pixi7' ? 'pixi7' : 'default'
  // 帧率固定 60，不再提供选项（出帧由渲染进程按显示刷新网格锚定，设置没意义了）
  setCheck('#top', !!settings.alwaysOnTop)
  setCheck('#click-through', !!settings.clickThrough)
  setCheck('#auto-start', !!settings.autoStart)
}

function setRange(sel, v) {
  const el = $(sel)
  if (el && document.activeElement !== el) el.value = v
}
/** 转头幅度读数：显示参数角度的请求幅度（模型量程 ±30°，超出部分会被夹住） */
function showHeadGain(g) {
  const el = $('#head-gain-readout')
  if (el) el.textContent = `${Math.round(27 * g)}°`
}
/** 待机频率读数：换算成「几秒一段动作」更直观（基础 8–18 秒） */
function showIdleSpeed(s) {
  const el = $('#idle-speed-readout')
  if (el) el.textContent = `${Math.round(8 / s)}–${Math.round(18 / s)}s`
}
/** 动作速度读数：1.0 = 预设速度上限（模型自带动作的节奏） */
function showActionSpeed(s) {
  const el = $('#action-speed-readout')
  if (el) el.textContent = `${s.toFixed(2)}×`
}
function setCheck(sel, on) {
  const el = $(sel)
  if (el) el.checked = !!on
}

// ---------- 事件 ----------
function wire() {
  $('#target-fps').onchange = e => pushSettings({targetFps:Number(e.target.value)})
  $('#strength').oninput = (e) => pushSettingsSoon({ strength: Number(e.target.value) })
  $('#head-gain').oninput = (e) => {
    const g = Number(e.target.value)
    showHeadGain(g)
    pushSettingsSoon({ headGain: g })
  }
  $('#pet-gain').oninput = (e) => pushSettingsSoon({ petGain: Number(e.target.value) })
  $('#gaze').onchange = (e) => pushSettings({ gaze: !!e.target.checked })
  const restartBtn = $('#restart-engine')
  if (restartBtn) restartBtn.onclick = () => window.shell?.restartEngine?.()
  $('#idle').onchange = (e) => pushSettings({ idle: !!e.target.checked })
  $('#random-faces').onchange = (e) => pushSettings({ randomFaces: !!e.target.checked })
  $('#idle-speed').oninput = (e) => {
    const s = Number(e.target.value)
    showIdleSpeed(s)
    pushSettingsSoon({ idleSpeed: s })
  }
  $('#action-speed').oninput = (e) => {
    const s = Number(e.target.value)
    showActionSpeed(s)
    pushSettingsSoon({ actionSpeed: s })
  }
  $('#bubble-on').onchange = (e) => pushSettings({ bubble: !!e.target.checked })
  // 模型表情 / 预设动作：列表从舞台的 meta 来（原包全部表情 + 姿势）
  $('#mode-normal').onclick = async () => {
    await rpc('exprClear')
    status('已回到常态')
    await loadModelLists()
  }
  loadModelLists()
  $('#border').onchange = (e) => pushSettings({ border: !!e.target.checked })
  $('#pad-y').oninput = (e) => {
    const v = Number(e.target.value)
    $('#pad-y-readout').textContent = `${Math.round(v * 100)}%`
    pushSettingsSoon({ padY: v })
  }
  $('#body-shape').oninput = (e) => {
    const v = Number(e.target.value)
    $('#body-shape-readout').textContent = v <= 0.01 ? '默认' : v >= 0.99 ? '体型2' : '体型 ' + Math.round(v * 100) + '%'
    pushSettingsSoon({ bodyShape: v })
  }
  $('#drag-physics').onchange = (e) => pushSettings({ dragPhysics: !!e.target.checked })
  $('#update-check').onchange = (e) => pushSettings({ updateCheck: !!e.target.checked })
  // 这两项要重建窗口才生效：提示用户重启舞台
  $('#native-core').onchange = (e) => pushSettings({ nativeCore: !!e.target.checked })
  $('#engine-select').onchange = (e) => pushSettings({ engine: e.target.value === 'pixi7' ? 'pixi7' : 'default' })
  $('#top').onchange = (e) => pushSettings({ alwaysOnTop: !!e.target.checked })
  $('#click-through').onchange = (e) => pushSettings({ clickThrough: !!e.target.checked })
  $('#auto-start').onchange = (e) => pushSettings({ autoStart: !!e.target.checked })

  $('#choose-model').onclick = async () => {
    status('正在打开选择框…')
    const r = await shell.chooseModel?.()
    if (r?.ok) status('已打开角色管理器，请在那里导入或切换角色')
  }
  $('#open-editor').onclick = () => shell.openEditor?.()
  $('#patch-export').onclick = async () => {
    const v = await rpc('patchExport')
    if (v?.ok) status('改动补丁已保存（stage-patch.json）')
    else if (v) status('补丁保存失败', true)
  }

  $('#win-center').onclick = () => { shell.center?.(); status('覆盖层已居中') }
  $('#quit').onclick = () => shell.quit?.()
}

// ---------- 模型表情 / 预设动作 ----------
// 列表来自舞台窗口的 meta（caps.expressions 全量 + POSES），点一下应用/取消，按钮高亮当前生效项。
let activeExprs = []
let activePose = '默认手'

function paintChips() {
  for (const btn of document.querySelectorAll('#expr-list .chip')) {
    btn.classList.toggle('on', activeExprs.includes(btn.dataset.expr))
  }
  for (const btn of document.querySelectorAll('#pose-list .chip')) {
    btn.classList.toggle('on', activePose === btn.dataset.pose)
  }
}

async function loadModelLists() {
  const meta = await rpc('meta')
  if (!meta) return
  activeExprs = meta.active?.exprs || []
  activePose = meta.active?.pose || '默认手'
  const exprBox = $('#expr-list')
  if (exprBox && !exprBox.dataset.built) {
    exprBox.dataset.built = '1'
    const skip = new Set(['体型1', '体型2', '默认体型']) // 体型改成拉条了，不再占按钮
    for (const name of (meta.exprs || []).filter((n) => !skip.has(n))) {
      const btn = document.createElement('button')
      btn.className = 'chip'
      btn.textContent = name
      btn.dataset.expr = name
      btn.onclick = async () => {
        const r = await rpc('expr', { name })
        if (!r) return
        activeExprs = r.active?.exprs || []
        paintChips()
      }
      exprBox.append(btn)
    }
  }
  // 官方动作与我们的预设分两组显示（meta.poses 现在带 official 标记）
  const poses = (meta.poses || []).map((p) => (typeof p === 'string' ? { name: p, official: true } : p))
  for (const [boxSel, wantOfficial] of [['#pose-list', true], ['#pose-custom', false]]) {
    const box = $(boxSel)
    if (!box || box.dataset.built) continue
    box.dataset.built = '1'
    for (const p of poses.filter((x) => !!x.official === wantOfficial)) {
      const btn = document.createElement('button')
      btn.className = 'chip'
      btn.textContent = p.name
      btn.dataset.pose = p.name
      btn.onclick = async () => {
        const r = await rpc('pose', { name: p.name })
        if (!r) return
        activePose = r.active?.pose || p.name
        paintChips()
      }
      box.append(btn)
    }
  }
  paintChips()
}

async function boot() {
  // 主题先落地（首帧别闪），再画表单
  await initTheme()
  mountThemeSwitch($('#theme-switch'))
  settings = (await shell.get?.()) || {}
  paint()
  shell.onSettings?.((next) => { settings = next || settings; paint() })
  wire()
  if (settings.profileMode === 'generic') {
    const note = document.createElement('div')
    note.className = 'hint'
    note.textContent = '通用角色模式：支持标准参数视线、眨眼、呼吸、点击反馈和模型自带表情。右键 / 中键拖动，Shift+滚轮缩放。'
    document.getElementById('panel').prepend(note)
    for (const id of ['border','pad-y','drag-physics','head-gain','pet-gain','random-faces','idle-speed','action-speed','body-shape']) {
      const el = document.getElementById(id)
      if (el) el.closest('.row').style.display = 'none'
    }
    for (const section of document.querySelectorAll('section')) {
      const title = section.querySelector('h3')?.textContent || ''
      if (title.includes('改完需重启') || title === '动作与发布') section.style.display = 'none'
      if (['待机动作','模型表情 / 动作','窗口'].includes(title)) for (const h of section.querySelectorAll('.hint')) h.style.display = 'none'
    }
  }
}

void boot()
