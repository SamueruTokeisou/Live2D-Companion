/**
 * 嘴型预设（语义化）：动作用名字引用，别在每条动作里手写一串魔法数字。
 *
 * 数值都是**相对待机嘴的偏移**（mouth.setMood 的语义），不是绝对值：
 * 待机的呼吸开合、情绪淡入淡出都还在，这里只叠一层。
 *
 * 和「说话」的分工：
 *   · 开合（open / funnel / pucker / jaw）由 `speakText` 的音节时间轴负责；
 *   · 这里主要管**表情形状**（smile / form / tongue / x）以及非说话时的口型。
 *   动作同时带台词时，renderer 会把开合类字段剔掉，避免两套叠加成「嘴被撕开」。
 */
const MOUTH_PRESETS = {
  常态: {},
  微笑: { smile: 0.35, form: 0.2 },
  偷笑: { smile: 0.55, form: 0.28, open: 0.08 },
  坏笑: { smile: 0.5, form: 0.35, open: 0.1 },
  张嘴: { open: 0.4, jaw: 0.3 },
  O嘴: { open: 0.3, funnel: 0.8, pucker: 0.5, form: -0.15, jaw: 0.2 },
  惊讶: { open: 0.5, funnel: 0.45, jaw: 0.35, form: -0.1 },
  撇嘴: { form: -0.55, open: 0.05, pucker: 0.15 },
  叹气: { open: 0.22, form: -0.18, jaw: 0.12 },
  咬牙: { open: 0.04, form: -0.2, jaw: 0.28 },
  鼓腮: { open: 0.1, form: 0.25, pucker: 0.55 },
  吐舌: { open: 0.22, tongue: 0.55, form: 0.1 },
  嘟嘴: { pucker: 0.65, form: 0.08, open: 0.08 },
}

/** 动作里的 mouth 字段：字符串 → 预设；对象 → 原样（兼容旧写法） */
export function mouthOf(spec) {
  if (!spec) return {}
  if (typeof spec === 'string') return { ...(MOUTH_PRESETS[spec] || {}) }
  return { ...spec }
}

/**
 * 带台词的动作：开合交给口型时间轴，只保留表情形状。
 * 否则「说话音节 + 静态 O 嘴」叠在一起，嘴会张得离谱。
 */
export function mouthForAction(spec, { speaking = false } = {}) {
  const m = mouthOf(spec)
  if (!speaking) return m
  const { open, funnel, pucker, jaw, ...rest } = m
  return rest
}

const MOUTH_PRESET_NAMES = Object.keys(MOUTH_PRESETS)
