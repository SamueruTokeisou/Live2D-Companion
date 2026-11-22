/**
 * 情绪状态（轻量）：由互动累积、随时间衰减，用来给待机选动作加权。
 *
 * 不是「演情绪」——真正的演出还是那 12 套语义配方（semantics.js）。
 * 这一层只回答一个问题：**现在更想做什么动作**。
 *   被摸头/被夸 → 开心、害羞多，待机会更常理头发、偷瞄；
 *   被摸胸/摸胯 → 生气、害羞多，待机会更常别过头、嫌弃；
 *   刚被逗过 → 好奇多，待机会东张西望。
 *
 * 数据只活在内存里，不写盘：重启就该恢复「刚认识你」的中性状态。
 * 和 history.js 的分工：history 记「发生过什么」，mood 记「攒成了什么心情」。
 */

import { EMOTION_NAMES } from './semantics.js'

/**
 * 动作 → 情绪标签（只用于加权；没标的动作权重恒为 1）
 */
const ROUTINE_MOOD = {
  理理头发: '害羞',
  捂嘴偷笑: '害羞',
  偷瞄: '好奇',
  东张西望: '好奇',
  凑近摇摆: '好奇',
  别过头: '生气',
  嫌弃: '生气',
  挥挥手: '开心',
  挥手打招呼: '开心',
  抖尾巴: '开心',
  打瞌睡: '困倦',
  伸懒腰: '困倦',
}

/**
 * 情绪名沿用 semantics 的 12 套配方，多一个「开心」：
 * 待机挥手的标签需要一个「单纯高兴」，而 semantics 里没有对应配方（开心不需要整段演出）。
 * 互动差分（variants.js）的标签也从这一套里挑，两边才对得上。
 */
const NAMES = [...EMOTION_NAMES, '开心']

export function createMood({ decay = 0.045, max = 2.5 } = {}) {
  const w = Object.fromEntries(NAMES.map((n) => [n, 0]))

  /** 加一点情绪（互动触发；同一事件重复叠加会边际递减） */
  function bump(name, amt = 1) {
    if (!(name in w) || !amt) return
    w[name] = Math.min(max, w[name] + amt)
  }

  /** 每帧衰减：半衰期约 15 秒，互动停下后慢慢回到中性 */
  function update(dtMs) {
    const k = Math.exp(-decay * (Math.max(0, dtMs) / 1000))
    for (const n of NAMES) w[n] *= k
  }

  /** 选动作的权重：标签匹配的情绪越高，越容易被挑中 */
  function weightOf(routineName) {
    const tag = ROUTINE_MOOD[routineName]
    return 1 + (tag ? w[tag] : 0) * 1.1
  }

  function top() {
    let best = null
    let v = 0.12
    for (const n of NAMES) if (w[n] > v) { best = n; v = w[n] }
    return best ? { name: best, value: Math.round(v * 100) / 100 } : null
  }

  return {
    bump, update, weightOf, top,
    state: () => ({ ...Object.fromEntries(NAMES.map((n) => [n, Math.round(w[n] * 100) / 100])), top: top() }),
  }
}

/** 互动热区 → 情绪增量（touch 事件里调用） */
export function moodForTouch(region = '', gesture = '') {
  const pet = gesture === 'pet' || gesture === 'drag'
  if (region === '头' || region === '额头' || region === '左脸' || region === '右脸') {
    return pet ? [['开心', 0.55], ['害羞', 0.45], ['撒娇', 0.2]] : [['好奇', 0.35]]
  }
  if (region === '胯') return [['生气', 1.2], ['害羞', 0.7], ['嫌弃', 0.35]]
  if (region === '胸') return [['生气', 0.8], ['害羞', 0.55], ['嫌弃', 0.3]]
  if (region === '腰') return [['害羞', 0.5], ['生气', 0.3], ['开心', 0.2]]
  if (region === '左手' || region === '右手') return [['害羞', 0.6], ['开心', 0.3], ['心动', 0.2]]
  if (region === '尾巴') return [['开心', 0.6], ['害羞', 0.35], ['傲娇', 0.25]]
  if (region === '脚' || region === '腿') return [['害羞', 0.35], ['好奇', 0.2], ['开心', 0.15]]
  if (region === '裙摆' || region === '长裙') return [['害羞', 0.45], ['生气', 0.35], ['慌乱', 0.3]]
  return [['好奇', 0.2]]
}
