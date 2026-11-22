/**
 * 终点姿势层（pose）—— 只记「动作做完时的参数值」，过渡由这一层自己补。
 *
 * 数值来源：模型自带 `Animation/*.motion3.json` 的最后一帧（手臂链），
 * 头/身体这类参数是我们自己补的（模型没给这套动作）。
 *
 * 两个写点：
 *   · 手臂链（Movement 与 Param 系列）每帧都钉住，默认手也钉（值等于默认，不影响观感）；
 *   · 头/身体这类「额外参数」只在反应动作进行中钉住，结束后解锁 ——
 *     否则会把 gaze 的转动永久压成 0。
 *
 * 写点必须在物理之前（layers.hold → applyPhysics），否则物理会算到上一帧的输入。
 */

/** 默认手（= 动画里的「切回默认」落点） */
const REST = {
  Movement1: 0, Movement2: 0, Movement3: 0,
  Param56: 1, Param57: 0,
  Param36: 0, Param39: 0, Param40: 0, Param41: 0, Param42: 0, Param43: 0,
  Param59: 0, Param60: 0, Param61: 0, Param62: 0,
}

/**
 * 预设：名字 → 终点参数。缺省的手臂参数按 REST 补齐。
 * extras 是「头/身体」这类会跟 gaze 抢的参数，只在动作期间钉。
 */
export const POSES = {
  默认手: { official: true, extras: {} },
  // 竖手指切出来动画.motion3.json @1.25s
  竖手指: {
    official: true,
    params: { Movement1: 0, Movement3: 1, Param40: 1, Param36: 0, Param39: 0.322, Param41: 0.702, Param42: 0 },
    extras: {},
  },
  // 默认手切举手.motion3.json @1.133s
  举手: {
    official: true,
    params: { Movement2: 1, Param62: 0.034, Param59: 0.476, Param60: 0.86, Param61: 0.022 },
    extras: {},
  },
  // 狗尾草切换出来.motion3.json @1.233s
  狗尾草: {
    official: true,
    params: { Movement1: 1, Param36: 0.04, Param39: 0.2, Param41: -0.732, Param42: 0 },
    extras: {},
  },
}

/** 官方动作（对应模型自带 motion3 的落点）；其余是我们自己拼的预设 */
export const OFFICIAL_POSES = ['默认手', '竖手指', '举手', '狗尾草']

/**
 * 单手状态：左右手各一套参数，互不覆盖。
 * 以前点哪只手都是切整只「竖手指」预设 —— 点右手也变成伸食指、点左手食指会缩回去。
 * 两套参数本来就是分开的：左手 = Movement1/Movement3 + Param36/39/40/41/42，
 * 右手 = Movement2 + Param59..62，可以同时挂着（竖食指 + 抚胸）。
 */
const HAND_STATES = {
  left: {
    竖手指: { Movement1: 0, Movement3: 1, Param40: 1, Param36: 0, Param39: 0.322, Param41: 0.702, Param42: 0 },
    狗尾草: { Movement1: 1, Param36: 0.04, Param39: 0.2, Param41: -0.732, Param42: 0 },
  },
  right: {
    抚胸: { Movement2: 1, Param62: 0.034, Param59: 0.476, Param60: 0.86, Param61: 0.022 },
  },
}
/** 预设名 → 影响哪只手 */
const HAND_OF = {
  left: { 竖手指: '竖手指', 狗尾草: '狗尾草' },
  right: { 举手: '抚胸', 抚胸: '抚胸' },
}

const smooth = (t) => t * t * (3 - 2 * t)

export function createPoses({ layers, fps = 60 } = {}) {
  const extraKeys = [...new Set(Object.values(POSES).flatMap((p) => Object.keys(p.extras || {})))]
  const armKeys = Object.keys(REST)

  const curArms = { ...REST }
  const curExtras = Object.fromEntries(extraKeys.map((k) => [k, 0]))
  let fromArms = { ...REST }, toArms = { ...REST }
  let fromExtras = { ...curExtras }, toExtras = { ...curExtras }
  let elapsed = 0
  let totalMs = 0
  let active = '默认手'
  /** 族内微调（加性偏移）：手势/呼吸/摇摆往姿势上叠一层，不破坏落点 */
  const curTune = Object.fromEntries(armKeys.map((k) => [k, 0]))
  let fromTune = { ...curTune }, toTune = { ...curTune }
  let tuneElapsed = 0
  let tuneTotal = 0
  /** 单手状态：'' = 放下；左：竖手指/狗尾草，右：抚胸 */
  const handState = { left: '', right: '' }
  const composeArms = () => ({
    ...REST,
    ...(HAND_STATES.left[handState.left] || {}),
    ...(HAND_STATES.right[handState.right] || {}),
  })
  const activeName = () => {
    const parts = [handState.left, handState.right].filter(Boolean)
    return parts.length ? parts.join(' + ') : '默认手'
  }
  /** 单手开关：左手 → 竖食指，右手 → 抚胸；两只手互不影响 */
  function toggleHand(side = 'left', ms = 260) {
    const on = side === 'right' ? '抚胸' : '竖手指'
    handState[side] = handState[side] === on ? '' : on
    fromArms = { ...curArms }
    toArms = composeArms()
    fromExtras = { ...curExtras }
    toExtras = Object.fromEntries(extraKeys.map((k) => [k, 0]))
    extrasOn = false
    elapsed = 0
    totalMs = Math.max(0, ms)
    active = activeName()
    if (totalMs === 0) Object.assign(curArms, toArms)
    return handState[side]
  }
  /** extras 是否还在生效（结束后解锁，避免永久压住 gaze） */
  let extrasOn = false

  const lerpTo = (name, ms, { holdExtras } = {}) => {
    const pose = POSES[name] || POSES['默认手']
    // 预设 → 单手状态（竖手指/狗尾草 = 左手；举手/抚胸 = 右手；默认手两只都放下）
    if (name === '默认手') { handState.left = ''; handState.right = '' }
    else if (HAND_OF.left[name]) handState.left = HAND_OF.left[name]
    else if (HAND_OF.right[name]) handState.right = HAND_OF.right[name]
    fromArms = { ...curArms }
    toArms = composeArms()
    fromExtras = { ...curExtras }
    toExtras = Object.fromEntries(extraKeys.map((k) => [k, (pose.extras && pose.extras[k]) || 0]))
    // 有 extras 的动作，结束后要保留（例如「护住」要维持几秒）；由调用方 release 才收回
    extrasOn = holdExtras !== undefined ? !!holdExtras : Object.keys(pose.extras || {}).length > 0
    elapsed = 0
    totalMs = Math.max(0, ms)
    active = activeName()
    if (totalMs === 0) { Object.assign(curArms, toArms); Object.assign(curExtras, toExtras) }
  }

  return {
    /** 每帧推进插值并钉进 layers.hold（必须在 layers.applyPhysics 之前调用） */
    apply(dtMs = 1000 / 60) {
      if (totalMs > 0) {
        elapsed = Math.min(totalMs, elapsed + dtMs)
        const k = smooth(elapsed / totalMs)
        for (const id of armKeys) {
          const a = fromArms[id] ?? REST[id]
          const b = toArms[id] ?? REST[id]
          curArms[id] = a + (b - a) * k
        }
        for (const id of extraKeys) curExtras[id] = (fromExtras[id] ?? 0) + ((toExtras[id] ?? 0) - (fromExtras[id] ?? 0)) * k
        if (elapsed >= totalMs) totalMs = 0
      }
      if (tuneTotal > 0) {
        tuneElapsed = Math.min(tuneTotal, tuneElapsed + dtMs)
        const tk = smooth(tuneElapsed / tuneTotal)
        for (const id of armKeys) curTune[id] = fromTune[id] + (toTune[id] - fromTune[id]) * tk
        if (tuneElapsed >= tuneTotal) tuneTotal = 0
      }
      for (const id of armKeys) layers.hold(id, curArms[id] + (curTune[id] || 0))
      if (extrasOn) for (const id of extraKeys) layers.hold(id, curExtras[id])
      return active
    },
    /** 切到一个预设；holdExtras 默认按预设是否带 extras 决定 */
    set(name, ms = 260, opts = {}) {
      if (!(name in POSES)) return false
      lerpTo(name, ms, opts)
      return true
    },
    /** 收回默认手（带 extras 的姿势会一起过渡回 0 并解锁） */
    release(ms = 240) {
      lerpTo('默认手', ms, { holdExtras: true })
      setTimeout(() => { if (active === '默认手') extrasOn = false }, Math.max(0, ms) + 40)
      return true
    },
    toggle(name = '竖手指', ms = 260) {
      const side = HAND_OF.left[name] ? 'left' : HAND_OF.right[name] ? 'right' : null
      if (side) return toggleHand(side, ms) || '默认手'
      const next = active === name ? '默认手' : name
      lerpTo(next, ms, { holdExtras: next !== '默认手' })
      return next
    },
    /** 单手开关（分区互动用）：side = 'left' | 'right'，返回该手的新状态（'' = 放下） */
    toggleHand,
    /**
     * 族内微调（加性偏移，带过渡）：给手势/摇摆/呼吸往当前姿势上叠一层。
     * 只认手臂链参数（REST 的键），其它参数请走 layers。
     */
    tune(map = {}, ms = 220) {
      const next = { ...toTune }
      for (const [id, v] of Object.entries(map)) {
        if (id in REST) next[id] = Number(v) || 0
      }
      fromTune = { ...curTune }
      toTune = next
      tuneElapsed = 0
      tuneTotal = Math.max(0, ms)
      if (tuneTotal === 0) Object.assign(curTune, toTune)
      return { ...curTune }
    },
    clearTune(ms = 220) { return this.tune(Object.fromEntries(armKeys.map((k) => [k, 0])), ms) },
    tuneState() { return { ...curTune } },
    /** 当前族的落点（手臂链绝对值），动作层把「目标姿势」换算成微调量时要用 */
    armBase() { return { ...curArms } },
    get active() { return active },
    state() {
      return { active, totalMs, elapsed, extrasOn, hands: { ...handState }, curArms: { ...curArms }, curExtras: { ...curExtras } }
    },
    presets() { return Object.keys(POSES) },
  }
}
