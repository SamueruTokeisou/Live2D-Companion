/**
 * 待机动作 —— 桌面上不互动时「自己在动」，别像一张贴纸。
 *
 * 两层叠加：
 *   1. **常驻微摆**：极慢的重心摇摆 + 轻微歪头 + 呼吸起伏，永远在，幅度小到不抢视线；
 *      这是「活着」的地基，不靠随机触发。
 *   2. **随机成套动作**：每隔 8–18 秒挑一个（重心换脚 / 东张西望 / 伸懒腰 / 打瞌睡 /
 *      抖尾巴 / 抖耳朵…），每个是一小段关键帧，首尾都归零，所以接得上下一次呼吸。
 *      部分动作会顺带触发一个表情（复用 idle-faces 的预设），动作 + 表情才算「有情绪」。
 *
 * 写点：**只往姿态总线累加**（见 pose-bus.js）。视线、姿态链、抚摸晃动也在同一份合成里，
 * 所以待机动作不会和「看鼠标」打架 —— 用户一互动，这里就让位（pause）。
 */

import { legChain } from './rig/rig.js'
import { EMOTIONS, emotionRoutine } from './semantics.js'

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const ease = (x) => x * x * (3 - 2 * x)          // smoothstep
const lerp = (a, b, k) => a + (b - a) * k

/**
 * 动作内联动：只补「动作没写、但身体应该跟着动」的次级参数。
 * 以前一套动作只有头在转、身体/眼睛/胯像钉死的，看起来就是一截一截的。
 * 规则：源头动了 → 上游跟一部分；动作自己写了就不补，避免叠成两倍。
 */
function linkedParams(frame) {
  const out = {}
  const has = (id) => frame[id] != null
  const ax = frame.ParamAngleX || 0
  const ay = frame.ParamAngleY || 0
  const az = frame.ParamAngleZ || 0
  const bx = frame.ParamBodyAngleX || 0
  const by = frame.ParamBodyAngleY || 0
  const bz = frame.ParamBodyAngleZ || 0
  const norm = (deg) => Math.max(-1, Math.min(1, deg / 30))
  if (ax) {
    if (!has('ParamBodyAngleX')) out.ParamBodyAngleX = ax * 0.28
    if (!has('ParamEyeBallX')) out.ParamEyeBallX = norm(ax) * 0.45
  }
  if (ay) {
    if (!has('ParamBodyAngleY')) out.ParamBodyAngleY = ay * 0.18
    if (!has('ParamEyeBallY')) out.ParamEyeBallY = norm(ay) * 0.35
  }
  if (az && !has('ParamBodyAngleZ')) out.ParamBodyAngleZ = az * 0.22
  if ((bx || bz) && !has('HipAngleZ')) out.HipAngleZ = -bx * 0.3 + bz * 0.18
  if (by && !has('ShoulderY')) out.ShoulderY = by * 0.15
  return out
}

/** 关键帧求值：keys = [[t0,v0],[t1,v1],...]（t 为 0..1 归一化） */
function sample(keys, p) {
  if (!keys?.length) return 0
  if (p <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]
    if (p <= t1) {
      const [t0, v0] = keys[i - 1]
      const span = t1 - t0 || 1
      return lerp(v0, v1, ease(clamp((p - t0) / span, 0, 1)))
    }
  }
  return keys[keys.length - 1][1]
}

/**
 * 动作库。数值是**角度增量**（度），会加到姿态总线上。
 * `face` 可选：开始播放时顺带戳一下 idle-faces 的预设（笑 / 吐舌头 …）。
 */
export const ROUTINES = {
  重心换脚: {
    ms: 5200,
    lines: ['站久了…换个脚。', '嗯…这边舒服点。'],
    tracks: {
      ParamBodyAngleX: [[0, 0], [0.28, 5.5], [0.62, 4.2], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.3, -2.6], [0.65, -1.8], [1, 0]],
      ParamAngleZ: [[0, 0], [0.3, 2.2], [0.7, 1.4], [1, 0]],
      ParamAngleX: [[0, 0], [0.3, -3.5], [0.7, -2.0], [1, 0]],
      HipAngleZ: [[0, 0], [0.35, -3.0], [1, 0]],
    },
  },
  东张西望: {
    ms: 5600,
    lines: ['咦，那边是什么？', '有人吗……', '嗯？刚才是谁。'],
    tracks: {
      ParamAngleX: [[0, 0], [0.22, 9], [0.46, 8], [0.72, -7], [1, 0]],
      ParamAngleY: [[0, 0], [0.3, 2.5], [0.7, -1.5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.25, -2.5], [0.7, 2.0], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 3.0], [0.75, -2.5], [1, 0]],
    },
  },
  伸懒腰: {
    ms: 4200,
    lines: ['伸个懒腰……', '唔——', '骨头要僵啦。'],
    tracks: {
      ParamAngleY: [[0, 0], [0.3, 7], [0.55, 8], [0.8, 2], [1, 0]],
      ParamBodyAngleY: [[0, 0], [0.3, 6.5], [0.6, 7], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.4, -2.0], [1, 0]],
      ShoulderY: [[0, 0], [0.35, 3.2], [0.7, 2.6], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.3, -0.35], [0.7, -0.25], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.3, -0.35], [0.7, -0.25], [1, 0]],
    },
    face: '笑',
  },
  打瞌睡: {
    ms: 6200,
    lines: ['……zzZ', '啊，我没睡！', '就眯一下下……'],
    tracks: {
      // 慢慢低头 → 猛地一抬（点头惊醒）→ 回正
      ParamAngleY: [[0, 0], [0.35, -9], [0.5, -10.5], [0.58, 3.5], [0.72, -1.5], [1, 0]],
      ParamAngleX: [[0, 0], [0.5, 3.5], [0.6, -1.0], [1, 0]],
      ParamAngleZ: [[0, 0], [0.45, -3.0], [0.62, 1.5], [1, 0]],
      ParamBodyAngleY: [[0, 0], [0.45, -5.5], [0.6, 2.0], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.4, -0.5], [0.56, -0.55], [0.62, 0], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.4, -0.5], [0.56, -0.55], [0.62, 0], [1, 0]],
    },
  },
  抖尾巴: {
    ms: 2400,
    lines: ['尾巴自己会动哦。'],
    lineChance: 0.25,
    tracks: {
      ParamBodyAngleZ: [[0, 0], [0.2, 3.0], [0.4, -3.0], [0.6, 2.4], [0.8, -1.6], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.25, 2.2], [0.55, -2.0], [1, 0]],
      ParamAngleZ: [[0, 0], [0.25, -2.2], [0.55, 1.8], [1, 0]],
    },
  },
  // 被摸尾巴：身体一扭把尾巴甩开 → 躲一下 → 又偷偷转回来看你 →
  // 脸上是「＞＜ + 脸红」（不想承认，但尾巴明显在摇）
  // manual: 只在「摸尾巴」时点名触发，不进随机待机池（不然会莫名其妙自己害羞）
  被摸尾巴: {
    ms: 2800,
    manual: true,
    lineChance: 0,
    tracks: {
      // 头：先别开（不承认），后半段瞟回来一眼，再别开
      ParamAngleX: [[0, 0], [0.15, -7], [0.4, -4], [0.62, 3.5], [0.8, -1.5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.18, -4], [0.5, 2.5], [0.8, -1], [1, 0]],
      ParamAngleY: [[0, 0], [0.3, 4], [0.7, -1], [1, 0]],
      // 眯眼：＞＜ 的骨架（表情层会再叠一层 ＞＜ + 脸红）
      ParamEyeLOpen: [[0, 0], [0.2, -0.45], [0.55, -0.5], [0.78, -0.2], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.2, -0.45], [0.55, -0.5], [0.78, -0.2], [1, 0]],
    },
    /**
     * 甩尾不放在 holds 里：ParamBodyAngleZ / HipAngleZ 会被姿态总线（poseBus.flush）整帧覆盖，
     * 动作系统写完等于没写。舞台侧由 renderer 的 tailWag 写入层独占这几个参数
     * （onBeforeUpdate 里排在 poseBus.flush 之后）。
     * 这里只留物理输入的后缩（LeanInput 不在总线里，写得住）。
     */
    holds: {
      LeanInput: [[0, 0], [0.12, 7], [0.5, 5], [0.85, 1.5], [1, 0]],
    },
  },
  理理头发: {
    ms: 4800,
    lines: ['头发乱没乱？', '嗯，还行。', '刚才有风吧。'],
    tracks: {
      ParamAngleX: [[0, 0], [0.3, -6], [0.6, -5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.3, 4.5], [0.62, 3.5], [1, 0]],
      ParamAngleY: [[0, 0], [0.35, -3.0], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.35, -2.5], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.35, 2.0], [1, 0]],
    },
  },
  // 吹狗尾草：举起狗尾草 → 小 O 嘴 → 一阵风吹动头发/耳朵
  吹狗尾草: {
    ms: 5600,
    lines: ['呼——', '草籽要飞走啦。', '轻轻的……'],
    pose: '狗尾草',
    gust: 2.2,
    mouth: { open: 0.3, funnel: 0.85, pucker: 0.6, form: -0.2 },
    tracks: {
      ParamAngleX: [[0, 0], [0.25, 4], [0.6, 3], [1, 0]],
      ParamAngleY: [[0, 0], [0.24, -5], [0.6, -4], [1, 0]],
      ParamAngleZ: [[0, 0], [0.3, 2.6], [0.62, -1.6], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 2.2], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.24, -0.22], [0.62, -0.28], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.24, -0.22], [0.62, -0.28], [1, 0]],
    },
  },
  // 拜拜：竖起左食指（Pose: 竖手指）→ 整条左臂左右摆（Param44 主摆）→ 小臂/手腕慢半拍跟随
  挥挥手: {
    ms: 8200,
    lines: ['这边这边～', '嗨——', '看到我了吗？'],
    pose: '竖手指',
    mouth: { smile: 0.3, open: 0.1 },
    tracks: {
      // 头/身体/眉：跟视线、姿态在一条线上，走加性总线
      ParamBrowLY: [[0, 0], [0.07, 0.5], [0.16, -0.1], [0.26, 0.55], [0.35, -0.1], [0.45, 0.6], [0.55, -0.05], [0.64, 0.4], [0.75, 0], [1, 0]],
      ParamBrowRY: [[0, 0], [0.07, 0.45], [0.16, -0.1], [0.26, 0.5], [0.35, -0.1], [0.45, 0.55], [0.55, -0.05], [0.64, 0.35], [0.75, 0], [1, 0]],
      ParamAngleX: [[0, 0], [0.3, 4], [0.75, 5], [1, 0]],
      ParamAngleY: [[0, 0], [0.3, 3], [0.75, 3.5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.3, -3], [0.7, 3], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 3], [1, 0]],
      ParamEyeBallX: [[0, 0], [0.3, 0.15], [0.8, 0.2], [1, 0]],
    },
    // 物理输出：必须用 hold 写绝对值，否则会被物理回算吃掉
    holds: {
      // 主摆：左臂 Z 整条手臂左右甩（-1 收向脸侧 → +1 甩到外侧）
      Param44: [[0, 0], [0.14, -1], [0.3, 1], [0.46, -1], [0.62, 1], [0.78, -0.6], [0.9, 0], [1, 0]],
      // 大臂：比主摆晚半拍、幅度小
      LArm: [[0, 0], [0.18, 0.15], [0.44, -0.1], [0.7, 0.1], [0.86, -0.04], [0.95, 0], [1, 0]],
      // 小臂：跟着甩，方向反着来一点，惯性感更足
      LForearm: [[0, 0], [0.16, -0.15], [0.34, 0.2], [0.5, -0.18], [0.66, 0.18], [0.82, -0.08], [0.94, 0], [1, 0]],
      // 手腕：最后跟上，幅度最小但能看出「甩」
      LWrist: [[0, 0], [0.22, 0.5], [0.38, -0.5], [0.54, 0.5], [0.7, -0.5], [0.84, 0.2], [0.95, 0], [1, 0]],
      ShoulderZ: [[0, 0], [0.26, 2.4], [0.66, -1.8], [0.95, 0], [1, 0]],
      ShoulderY: [[0, 0], [0.3, -1.2], [0.7, 1.0], [0.95, 0], [1, 0]],
      HipAngleZ: [[0, 0], [0.26, 1.8], [0.7, -1.5], [1, 0]],
    },
  },
  // 戴铁盆：钢盆表情 + 摇头晃脑（左摇右晃，带一点身体跟随）
  戴铁盆: {
    ms: 5400,
    lines: ['铛——', '这样就不怕撞头啦。', '稳不稳？'],
    exprs: ['钢盆'],
    mouth: { smile: 0.22, open: 0.06 },
    tracks: {
      ParamAngleZ: [[0, 0], [0.12, -7], [0.28, 7], [0.44, -6], [0.6, 6], [0.76, -4], [0.9, 3], [1, 0]],
      ParamAngleX: [[0, 0], [0.18, 4], [0.5, -4], [0.82, 3], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.14, -4], [0.34, 4], [0.56, -3.5], [0.76, 3], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 2.0], [1, 0]],
    },
  },
  // 凑近摇摆：竖食指 + 前倾 + 右手抬到背后 → 身体先沉再顶（不做镜像翻转了）
  凑近摇摆: {
    ms: 2800,
    lines: ['嗨呀～', '看这边！', '晃一晃～'],
    pose: '竖手指',
    mouth: { smile: 0.35, open: 0.08 },
    tracks: {
      ParamBodyAngleY: [[0, 0], [0.16, -6], [0.34, 1], [0.5, 7.5], [0.66, 1], [0.84, -3], [1, 0]],
      ParamAngleY: [[0, 0], [0.16, -4], [0.5, 5], [0.84, -2], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 3], [0.6, -2.5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.22, -4], [0.5, 4], [0.78, -2], [1, 0]],
      HipAngleZ: [[0, 0], [0.3, -3], [0.6, 3], [1, 0]],
    },
    holds: {
      // 前倾（纯物理输入：hold 会在物理之前写，物理链整条跟着动）
      LeanInput: [[0, 0], [0.14, -26], [0.6, -24], [0.86, -10], [1, 0]],
      // 右手抬到背后（Movement2 是默认手的姿势键，poses 每帧 hold 0，这里覆盖）
      Movement2: [[0, 0], [0.18, 1], [0.8, 1], [1, 0]],
      // 食指晃
      Param44: [[0, 0], [0.2, -1], [0.34, 1], [0.48, -0.9], [0.62, 0.9], [0.76, -0.5], [1, 0]],
      LWrist: [[0, 0], [0.26, 0.5], [0.4, -0.5], [0.54, 0.45], [0.68, -0.4], [0.84, 0.15], [1, 0]],
    },
  },
  // 前倾 + 脸前晃手：手在脸前左右晃 = 「杂鱼~杂鱼~」那种调戏。
  // 举手族的手臂链（Param62/59/60）连续可解：62 越小手越往脸中间靠，59 越大越贴脸。
  杂鱼晃手: {
    ms: 3600,
    lines: ['杂鱼~杂鱼~', '诶——就这样？', '连这个都不会吗，杂鱼。'],
    lineChance: 0.75,
    pose: '举手',
    mouth: { smile: 0.55, open: 0.12, form: 0.3 },
    tracks: {
      ParamAngleX: [[0, 0], [0.16, 3], [0.55, 4], [0.86, 2], [1, 0]],
      ParamAngleY: [[0, 0], [0.16, -3], [0.55, -4], [1, 0]],
      ParamAngleZ: [[0, 0], [0.15, 5], [0.5, 6], [0.85, 3], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.2, 3.5], [0.6, 3], [1, 0]],
      ParamBrowRY: [[0, 0], [0.2, 0.45], [0.8, 0.35], [1, 0]],
      ParamBrowLY: [[0, 0], [0.2, 0.4], [0.8, 0.3], [1, 0]],
      ParamEyeBallY: [[0, 0], [0.2, -0.12], [1, 0]],
    },
    // 前倾靠物理输入（必须在物理前写）
    holds: {
      LeanInput: [[0, 0], [0.16, -24], [0.72, -22], [0.92, -8], [1, 0]],
    },
    // 手位：脸前（捂嘴位）→ 手腕左右晃
    arms: {
      Param62: [[0, 0], [0.2, -0.85], [0.75, -0.85], [1, 0]],
      Param59: [[0, 0], [0.2, 0.95], [0.75, 0.95], [1, 0]],
      Param60: [[0, 0], [0.2, 0.05], [0.75, 0.05], [1, 0]],
      Param61: [[0, 0], [0.24, 0.5], [0.36, -0.5], [0.48, 0.5], [0.6, -0.45], [0.72, 0.3], [0.86, 0], [1, 0]],
    },
  },
  // 捂嘴偷笑：手抬到嘴边，肩膀缩一下，脸红
  捂嘴偷笑: {
    ms: 3200,
    lines: ['噗……', '才、才没有笑呢。', '哼，别看我。'],
    pose: '举手',
    exprs: ['脸红'],
    mouth: { smile: 0.7, open: 0.1 },
    tracks: {
      ParamAngleX: [[0, 0], [0.2, -5], [0.7, -4], [1, 0]],
      ParamAngleY: [[0, 0], [0.2, -2], [1, 0]],
      ParamAngleZ: [[0, 0], [0.2, 4], [0.7, 3], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.25, -2], [1, 0]],
      ShoulderY: [[0, 0], [0.22, 1.8], [0.8, 1.5], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.24, -0.25], [0.7, -0.2], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.24, -0.25], [0.7, -0.2], [1, 0]],
    },
    arms: {
      Param62: [[0, 0], [0.24, -1], [0.78, -1], [1, 0]],
      Param59: [[0, 0], [0.24, 1], [0.78, 1], [1, 0]],
      Param60: [[0, 0], [0.24, 0], [0.78, 0], [1, 0]],
    },
  },
  // 托腮：手背贴脸，眼睛半闭，身体轻轻歪
  托腮: {
    ms: 4200,
    lines: ['嗯……', '在听呢。', '发呆不行吗？'],
    lineChance: 0.35,
    pose: '举手',
    mouth: { smile: 0.2, open: 0.04 },
    tracks: {
      ParamAngleX: [[0, 0], [0.18, -4], [0.72, -3], [1, 0]],
      ParamAngleY: [[0, 0], [0.18, -3], [1, 0]],
      ParamAngleZ: [[0, 0], [0.18, 9], [0.75, 8], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.25, -2.5], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.25, 2], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.25, -0.2], [0.75, -0.18], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.25, -0.2], [0.75, -0.18], [1, 0]],
    },
    arms: {
      Param62: [[0, 0], [0.22, -0.5], [0.8, -0.5], [1, 0]],
      Param59: [[0, 0], [0.22, 1], [0.8, 1], [1, 0]],
      Param60: [[0, 0], [0.22, 0], [0.8, 0], [1, 0]],
    },
  },
  // 半平举：手臂抬到胸侧，像「你看我干嘛」的摊手
  半平举: {
    ms: 3000,
    lines: ['怎么啦？', '有事说事。', '我又没说不帮。'],
    pose: '举手',
    mouth: { smile: 0.15, open: 0.06, form: -0.15 },
    tracks: {
      ParamAngleX: [[0, 0], [0.22, 4], [0.7, 3], [1, 0]],
      ParamAngleY: [[0, 0], [0.22, 2], [1, 0]],
      ParamAngleZ: [[0, 0], [0.22, -3], [0.7, -2], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.25, -2], [1, 0]],
      ShoulderY: [[0, 0], [0.25, 1.2], [0.75, 1], [1, 0]],
      ParamBrowRY: [[0, 0], [0.25, 0.35], [1, 0]],
      ParamBrowLY: [[0, 0], [0.25, 0.3], [1, 0]],
    },
    arms: {
      Param62: [[0, 0], [0.25, 1], [0.75, 1], [1, 0]],
      Param60: [[0, 0], [0.25, 0.5], [0.75, 0.5], [1, 0]],
      Param59: [[0, 0], [0.25, 0], [0.75, 0], [1, 0]],
    },
  },
  // 高举欢呼：手臂举过头顶
  高举: {
    ms: 2600,
    lines: ['耶——', '我赢啦！', '哼哼～'],
    lineChance: 0.6,
    pose: '举手',
    mouth: { smile: 0.8, open: 0.5 },
    tracks: {
      ParamAngleY: [[0, 0], [0.2, 5], [0.75, 4], [1, 0]],
      ParamAngleX: [[0, 0], [0.2, -3], [1, 0]],
      ParamBodyAngleY: [[0, 0], [0.2, 4], [0.75, 3], [1, 0]],
      ParamBrowRY: [[0, 0], [0.2, 0.5], [1, 0]],
      ParamBrowLY: [[0, 0], [0.2, 0.5], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.2, 0.12], [0.8, 0.1], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.2, 0.12], [0.8, 0.1], [1, 0]],
    },
    arms: {
      Param62: [[0, 0], [0.2, 1], [0.78, 1], [1, 0]],
      Param59: [[0, 0], [0.2, -1], [0.78, -1], [1, 0]],
      Param60: [[0, 0], [0.2, -0.5], [0.78, -0.5], [1, 0]],
    },
  },
  // 侧平举挥手：手臂抬到侧上方左右挥
  挥手打招呼: {
    ms: 3400,
    lines: ['这边～', '嗨！', '看到我啦？'],
    lineChance: 0.5,
    pose: '举手',
    mouth: { smile: 0.6, open: 0.15 },
    tracks: {
      ParamAngleX: [[0, 0], [0.2, 3], [0.8, 3], [1, 0]],
      ParamAngleZ: [[0, 0], [0.2, -4], [0.8, -3], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.25, -2.5], [1, 0]],
      ParamEyeBallX: [[0, 0], [0.2, 0.15], [1, 0]],
    },
    arms: {
      Param62: [[0, 0], [0.2, 0.5], [0.82, 0.5], [1, 0]],
      Param59: [[0, 0], [0.2, 0], [0.82, 0], [1, 0]],
      Param60: [[0, 0], [0.2, -0.5], [0.82, -0.5], [1, 0]],
      Param61: [[0, 0], [0.26, 0.55], [0.4, -0.5], [0.54, 0.5], [0.68, -0.45], [0.82, 0.2], [1, 0]],
    },
  },
  // 扭腰两下：胯先动，上身反向补，手臂自然跟着摆
  扭腰: {
    ms: 2600,
    lines: ['哼——', '人家可是很努力的。', '就、就夸一句嘛。'],
    lineChance: 0.5,
    tracks: {
      ParamBodyAngleZ: [[0, 0], [0.18, -9], [0.38, 9], [0.58, -7], [0.78, 5], [1, 0]],
      HipAngleZ: [[0, 0], [0.18, 10], [0.38, -10], [0.58, 7], [0.78, -4], [1, 0]],
      // 腿反向补：胯往左、腿往右，才像「摆腰」而不是整块板子平移
      LEGAngleZ2: [[0, 0], [0.18, -7], [0.38, 7], [0.58, -5], [0.78, 3], [1, 0]],
      Param33: [[0, 0], [0.18, 0.35], [0.58, 0.25], [1, 0]],
      ParamAngleZ: [[0, 0], [0.18, 5], [0.38, -5], [0.58, 3.5], [0.78, -2], [1, 0]],
      ParamAngleX: [[0, 0], [0.2, -3], [0.55, 3], [1, 0]],
      ParamEyeBallX: [[0, 0], [0.2, 0.3], [0.55, -0.2], [1, 0]],
    },
    arms: {
      Param62: [[0, 0], [0.2, 0.25], [0.5, -0.1], [0.8, 0.15], [1, 0]],
    },
  },
  // 护胸：被摸胸后再碰 = 防御（手挡胸前 + 后仰 + 扭两下 + 别开脸）
  护胸防御: {
    ms: 3000,
    lines: ['恬……恬不知耻！', '不、不许再摸了！', '再过来我要生气了哦。'],
    lineChance: 0,
    pose: '举手',
    exprs: ['脸红'],
    mouth: { form: -0.5, open: 0.12 },
    tracks: {
      ParamAngleX: [[0, 0], [0.18, 14], [0.62, 12], [1, 0]],
      ParamAngleY: [[0, 0], [0.18, 5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.18, 6], [0.55, -4], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.16, -8], [0.4, 8], [0.66, -5], [1, 0]],
      HipAngleZ: [[0, 0], [0.16, 9], [0.4, -9], [0.66, 5], [1, 0]],
      ParamEyeBallX: [[0, 0], [0.2, -0.35], [1, 0]],
      ParamBrowRY: [[0, 0], [0.2, -0.35], [0.7, -0.25], [1, 0]],
      ParamBrowLY: [[0, 0], [0.2, -0.35], [0.7, -0.25], [1, 0]],
    },
    holds: {
      LeanInput: [[0, 0], [0.16, 14], [0.8, 10], [1, 0]],
    },
    arms: {
      Param62: [[0, 0], [0.18, -0.5], [0.85, -0.5], [1, 0]],
      Param59: [[0, 0], [0.18, 0], [0.85, 0], [1, 0]],
      Param60: [[0, 0], [0.18, 0], [0.85, 0], [1, 0]],
    },
  },
  // 别过头（哼）：头转开、眼睛也躲，肩一耸，身体反向带一点
  别过头: {
    ms: 2600,
    lines: ['哼！', '……谁要理你。', '刚才那句，再说一遍。'],
    lineChance: 0.55,
    mouth: { form: -0.35, open: 0.05 },
    tracks: {
      ParamAngleX: [[0, 0], [0.18, 26], [0.72, 22], [1, 0]],
      ParamAngleZ: [[0, 0], [0.18, 5], [0.72, 4], [1, 0]],
      ParamAngleY: [[0, 0], [0.18, 4], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.2, -3], [1, 0]],
      ParamEyeBallX: [[0, 0], [0.2, -0.55], [0.8, -0.5], [1, 0]],
      ParamBrowRY: [[0, 0], [0.2, -0.2], [1, 0]],
      ParamBrowLY: [[0, 0], [0.2, -0.2], [1, 0]],
      ShoulderY: [[0, 0], [0.2, 0.8], [1, 0]],
    },
  },
  // 鼓腮：憋气，脸鼓起来，眼睛斜上看
  鼓腮: {
    ms: 2800,
    lines: ['哼——不跟你说话了。', '噗……', '才没有生气。'],
    lineChance: 0.55,
    mouth: { form: -0.25, open: 0.02, pucker: 0.5 },
    tracks: {
      CheeckPuff: [[0, 0], [0.2, 1], [0.75, 1], [0.9, 0], [1, 0]],
      CheeckPuff2: [[0, 0], [0.24, 0.8], [0.75, 0.8], [0.9, 0], [1, 0]],
      CheeckPuffR: [[0, 0], [0.24, 0.9], [0.75, 0.9], [0.9, 0], [1, 0]],
      CheeckPuffL: [[0, 0], [0.24, 0.9], [0.75, 0.9], [0.9, 0], [1, 0]],
      ParamAngleZ: [[0, 0], [0.2, 4], [1, 0]],
      ParamAngleX: [[0, 0], [0.22, 8], [0.8, 6], [1, 0]],
      ParamEyeBallY: [[0, 0], [0.24, -0.25], [0.8, -0.2], [1, 0]],
      ParamAngleY: [[0, 0], [0.3, -2], [1, 0]],
    },
  },
  // 后退半步：重心后撤 + 后仰（物理输入走 holds）
  后退半步: {
    ms: 2400,
    lines: ['干、干嘛突然出声！', '吓我一跳……', '站远一点啦。'],
    lineChance: 0.6,
    tracks: {
      ParamAngleY: [[0, 0], [0.16, 5], [0.7, 4], [1, 0]],
      ParamAngleX: [[0, 0], [0.2, 10], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.2, 3], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.2, -2.5], [1, 0]],
      HipAngleYDOWN: [[0, 0], [0.2, 10], [0.8, 8], [1, 0]],
      LEGAngleZ2: [[0, 0], [0.2, -4], [0.8, -3], [1, 0]],
      Param33: [[0, 0], [0.2, 0.3], [0.8, 0.25], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.14, 0.25], [0.6, 0.1], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.14, 0.25], [0.6, 0.1], [1, 0]],
    },
    holds: {
      LeanInput: [[0, 0], [0.18, 15], [0.8, 12], [1, 0]],
    },
  },
  // 指人：竖食指 + 手臂前伸 + 前倾（「就是你，杂鱼」）
  指人: {
    ms: 2400,
    lines: ['就是你，杂鱼。', '听好了，我只说一次。', '看这里啦。'],
    lineChance: 0.7,
    pose: '竖手指',
    mouth: { form: 0.15, open: 0.1 },
    tracks: {
      ParamAngleY: [[0, 0], [0.18, 2], [0.75, 2], [1, 0]],
      ParamAngleX: [[0, 0], [0.18, -4], [0.75, -3], [1, 0]],
      ParamAngleZ: [[0, 0], [0.18, -3], [1, 0]],
      ParamBrowRY: [[0, 0], [0.18, 0.3], [1, 0]],
      ParamBrowLY: [[0, 0], [0.18, 0.25], [1, 0]],
    },
    holds: {
      LeanInput: [[0, 0], [0.18, -8], [0.78, -6], [1, 0]],
      // 食指那套的手臂微伸（绝对值）
      Param44: [[0, 0], [0.2, -0.35], [0.75, -0.3], [1, 0]],
      LWrist: [[0, 0], [0.24, 0.12], [1, 0]],
    },
  },
  // 撩头发：手从托腮位扫到侧平举（手背擦过耳侧），头先低后抬
  撩头发: {
    ms: 3200,
    lines: ['头发…乱了。', '别误会，只是挡眼睛。', '嗯，好了。'],
    lineChance: 0.4,
    pose: '举手',
    mouth: { smile: 0.2, open: 0.03 },
    tracks: {
      ParamAngleX: [[0, 0], [0.2, -5], [0.55, 3], [0.8, 1], [1, 0]],
      ParamAngleZ: [[0, 0], [0.2, 7], [0.6, -2], [1, 0]],
      ParamAngleY: [[0, 0], [0.3, -4], [0.6, 2], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.25, 2], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.35, -0.12], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.35, -0.12], [1, 0]],
    },
    arms: {
      Param62: [[0, 0], [0.18, -0.5], [0.45, 0.1], [0.7, 0.5], [0.9, 0.1], [1, 0]],
      Param59: [[0, 0], [0.18, 1], [0.45, 0.4], [0.7, 0], [1, 0]],
      Param60: [[0, 0], [0.18, 0], [0.45, -0.2], [0.7, -0.5], [1, 0]],
      Param61: [[0, 0], [0.3, 0.3], [0.55, -0.2], [0.8, 0.1], [1, 0]],
    },
  },
  // 跺脚：没有单腿抬起的参数，用「身体下沉 + 并腿 + 头一顿」模拟
  跺脚: {
    ms: 2400,
    lines: ['好麻烦——！', '哼！', '不听不听！'],
    lineChance: 0.6,
    mouth: { form: -0.3, open: 0.15 },
    tracks: {
      ParamBodyAngleY: [[0, 0], [0.12, -3.5], [0.22, 1.5], [0.34, -3], [0.46, 1.2], [0.7, 0.4], [1, 0]],
      ParamAngleY: [[0, 0], [0.12, -4], [0.3, 1], [0.5, -2], [1, 0]],
      ParamAngleZ: [[0, 0], [0.14, 3], [0.4, -2.5], [0.7, 1.5], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.14, -3], [0.42, 3], [0.7, -1.5], [1, 0]],
      HipAngleZ: [[0, 0], [0.14, 4], [0.42, -4], [0.7, 2], [1, 0]],
    },
    // 腿是物理输出（isOut）：往总线写会被物理回算吃掉，只有 hold（物理之后写绝对值）压得住
    holds: {
      LEGAngleZ2: [[0, 0], [0.12, -11], [0.24, 5], [0.36, -8], [0.5, 3], [1, 0]],
      Param33: [[0, 0], [0.14, 0.5], [0.4, 0.35], [0.8, 0.1], [1, 0]],
    },
  },
  // 偷瞄：头不动、只有眼睛偷偷转回来（傲娇三拍的收尾，价值最高的微动作）
  偷瞄: {
    ms: 1600,
    lines: ['……刚才那句，再说一遍。', '才、才没有在看你。'],
    lineChance: 0.45,
    mouth: { form: 0.1, open: 0.02 },
    tracks: {
      ParamEyeBallX: [[0, 0], [0.22, 0.55], [0.6, 0.5], [0.82, 0], [1, 0]],
      ParamEyeBallY: [[0, 0], [0.22, -0.12], [0.8, -0.1], [1, 0]],
      ParamAngleZ: [[0, 0], [0.25, 2], [0.8, 1.5], [1, 0]],
      ParamBrowRY: [[0, 0], [0.25, 0.3], [0.8, 0.25], [1, 0]],
      ParamBrowLY: [[0, 0], [0.25, 0.3], [0.8, 0.25], [1, 0]],
    },
  },
  // 半眯眼嫌弃（轻动作，不动手）
  嫌弃: {
    ms: 2000,
    lines: ['哈啊……', '你认真的？', '就这？'],
    lineChance: 0.5,
    tracks: {
      ParamEyeLOpen: [[0, 0], [0.2, -0.45], [0.8, -0.4], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.2, -0.45], [0.8, -0.4], [1, 0]],
      ParamAngleZ: [[0, 0], [0.2, 3], [1, 0]],
      ParamAngleX: [[0, 0], [0.2, 10], [0.8, 8], [1, 0]],
      ParamMouthForm: [[0, 0], [0.2, -0.35], [0.8, -0.3], [1, 0]],
      ParamBrowRY: [[0, 0], [0.2, -0.25], [1, 0]],
      ParamBrowLY: [[0, 0], [0.2, -0.25], [1, 0]],
    },
  },
  // 扭扭腿：这个模型**没有独立腿骨**，所以腿不是自己动的 ——
  // 写胯（HipAngleZ）和分腿（Param33），腿由 rig.legChain 带着走，躯干再反向补一点。
  扭扭腿: {
    ms: 3000,
    lines: ['腿麻了……', '扭一扭。', '哼，随便动动。'],
    lineChance: 0.45,
    mouth: { form: 0.15, open: 0.03 },
    tracks: {
      // 胯转到 ±14°：物理会把腿带过去（实测腿≈胯×0.9），视觉上才看得出腿在摆
      HipAngleZ: [[0, 0], [0.14, 14], [0.34, -14], [0.54, 11], [0.74, -8], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.2, -4], [0.5, 4], [0.8, -2.5], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.25, 3], [0.6, -2.4], [1, 0]],
      ParamAngleZ: [[0, 0], [0.3, 3], [0.6, -2.4], [1, 0]],
      ParamAngleX: [[0, 0], [0.35, 3.5], [0.7, -2.5], [1, 0]],
    },
    // 并/分腿和腿的转向都是物理输出，只能 hold（物理之后写绝对值）：
    // 腿的角度按「胯 × 0.93」跟过去 —— 这就是「绑在胯上」，脚一开一合比纯旋转显眼得多
    holds: {
      LEGAngleZ2: [[0, 0], [0.14, 13], [0.34, -13], [0.54, 10], [0.74, -7], [1, 0]],
      Param33: [[0, 0], [0.2, 0.55], [0.4, -0.3], [0.65, 0.45], [0.85, -0.2], [1, 0]],
    },
  },
}

/**
 * 组合演出（连拍）：一句话演一整套，名字可以直接给 `act` / 【动作|…】。
 * 节拍来自调研报告「动作组合与节奏建议」——每拍 0.4~1.2s，最后一拍收在小动作上。
 */
const COMBOS = {
  傲娇三拍: ['别过头', '偷瞄', '撩头发'],          // 赌气 → 偷看 → 装没事
  雌小鬼挑衅: ['指人', '杂鱼晃手', '嫌弃'],        // 指 → 晃 → 半眯眼收尾
  被摸反应: ['后退半步', '护胸防御'],              // 退 → 护住
  撒娇索要: ['扭腰', '半平举', '托腮'],            // 扭 → 摊手 → 托腮等你
  破功反差: ['杂鱼晃手', '嫌弃', '捂嘴偷笑'],      // 得意 → 僵住 → 破功
  害羞嘴硬: ['捂嘴偷笑', '别过头', '偷瞄'],        // 笑场 → 甩头 → 偷看
}

/**
 * 语义配方并入动作库：`【情绪|傲娇】` 与 `【动作|傲娇】` 等价。
 * 标 emotion:true，随机待机**不会**挑到 —— 情绪是被点名的，不是自己乱演的。
 */
const EMOTION_KEYS = Object.keys(EMOTIONS)
for (const name of EMOTION_KEYS) {
  ROUTINES[name] = { ...emotionRoutine(EMOTIONS[name]), emotion: true }
}

export function createIdleMotions({ bus, param, life, idleFaces, onLine, onStart, onFinish, onHold, onArms, armBase, options = {} } = {}) {
  const cfg = {
    enabled: true,
    speed: 1,           // 待机「换动作的频率」倍数：越大换得越勤（只影响间隔）
    // 动作播放速度：1 = 预设速度上限（与模型自带 motion 同量级），0.5 = 慢一倍。
    // **只作用于动作轨道**；手臂/裙子的贴图切换（poses.set、裙子切换）保持固定时长，
    // 因为那两处是部件淡入淡出，变速会让贴图糊在一起。
    playback: 0.8,
    minGap: 8,          // 成套动作间隔（秒）
    maxGap: 18,
    startDelay: 6,
    fade: 0.45,         // 动作首尾的淡入淡出（秒），防止硬起停
    lineChance: 0.5,    // 动作附带一句小台词的概率
    lineMs: 4200,       // 台词停留时长
    // 常驻微摆的幅度（度）；0 就是只有随机动作
    swayX: 1.8,
    swayZ: 0.9,
    swayHeadZ: 0.7,
    swayHeadY: 0.8,
    // 动作内联动（头→身体/眼睛、身体→胯/肩），关掉就是「只播轨道」
    link: true,
    // 情绪加权：给动作名返回权重（1 = 中性）；见 mood.js
    bias: null,
    ...options,
  }

  let t = Math.random() * 20   // 起始相位随机，换个窗口不会同步得像机器人
  let next = cfg.startDelay
  let cur = null               // { name, r, t, ms }
  let last = null
  let plays = 0
  let pausedUntil = 0
  /** 最近做过的动作（防重复）：随机待机不在这个窗口里挑，否则同一套动作反复出现 */
  const recentPicks = []
  // 需要「钉住」的参数（物理输出也能压住）：每帧写绝对值，动作结束/让位时释放
  const heldIds = new Set()
  function releaseHolds() {
    for (const id of heldIds) { try { onHold?.(id, null) } catch {} }
    heldIds.clear()
  }

  /** 用户一互动就让位：互动期间不换新动作，正在播的也快速收尾（手动点名的动作除外） */
  function pause(ms = 1500) {
    pausedUntil = Math.max(pausedUntil, performance.now() + ms)
    if (cur && !cur.manual && cur.t > cur.ms * 0.5) {
      const done = cur
      cur = null
      try { onFinish?.(done.name, done.r) } catch {}
    }
  }

  /**
   * 互动打断：不是「暂停」，而是把当前动作彻底停掉 —— 交给 onFinish 撤表情/姿势/嘴型，
   * 再释放钉住的参数。否则会出现「黑脸时还在做打瞌睡」这种一只眼睁一只眼闭的怪状态。
   */
  function reset(ms = 2200) {
    const done = cur
    cur = null
    if (done) { try { onFinish?.(done.name, done.r) } catch {} }
    releaseHolds()
    pausedUntil = Math.max(pausedUntil, performance.now() + ms)
  }

  /** 解除让位（外部控制用；不再等满 pause 窗口） */
  function resume() {
    pausedUntil = 0
  }

  /** 链式动作：'甲>乙>丙' 依次播；播完一个自动接下一个 */
  let queue = []

  /**
   * 开始播一个动作。
   * @param {string} name
   * @param {{manual?:boolean}} [opts] manual = 外部点名（agent / 组合连拍），
   *   不受「让位窗口」限制继续推进 —— 否则会写进池子却一帧都不动。
   */
  function start(name, opts = {}) {
    const r = ROUTINES[name]
    if (!r) return null
    cur = { name, r, t: 0, ms: r.ms, manual: !!opts.manual }
    last = name
    recentPicks.push(name)
    if (recentPicks.length > 4) recentPicks.shift()
    try { onStart?.(name, r, { manual: !!opts.manual }) } catch {}
    plays += 1
    next = cfg.minGap + Math.random() * (cfg.maxGap - cfg.minGap)
    if (r.face) idleFaces?.trigger?.(r.face)
    if (name === '抖尾巴') life?.flap?.(Math.random() < 0.5 ? 'L' : 'R', 0.55)
    // 情绪配方可以带一次耳朵扑棱（B = 两只一起）；扑棱的「转动」由 life 层叠加
    if (r.flap) life?.flap?.(r.flap, r.flapAmp ?? 0.8)
    // 小台词：不是每个动作都说话，概率低一点，桌面才不会像弹幕
    const chance = r.lineChance ?? cfg.lineChance
    if (onLine && r.lines?.length && Math.random() < chance) {
      const text = r.lines[Math.floor(Math.random() * r.lines.length)]
      onLine(text, cfg.lineMs)
    }
    return name
  }

  function trigger(name, opts = {}) {
    // 组合：名字直接命中 COMBOS 就展开成链
    if (name && COMBOS[name]) {
      queue = COMBOS[name].slice(1)
      return start(COMBOS[name][0], opts)
    }
    const seq = typeof name === 'string' && name.includes('>')
      ? name.split('>').map((s) => s.trim()).filter(Boolean)
      : null
    if (seq) {
      const bad = seq.find((n) => !ROUTINES[n])
      if (bad) return null
      queue = seq.slice(1)
      return start(seq[0], opts)
    }
    if (name && !ROUTINES[name]) return null
    queue = []
    // 随机待机只从「动作」里挑，情绪配方必须被点名（否则会自己乱演一通傲娇）。
    // 再排除最近 4 条做过的：短时间重复同一套动作，最像「循环 GIF」。
    const names = Object.keys(ROUTINES).filter((n) => !ROUTINES[n].emotion && !ROUTINES[n].manual)
    const fresh = names.filter((n) => !recentPicks.includes(n))
    const base = name ? [name] : (fresh.length ? fresh : names.filter((n) => n !== last))
    // 情绪加权：心情对哪类动作高，就更可能挑到它（仍保留随机性，不变成「只会做一种」）
    let pick = base[0]
    if (!name) {
      const weights = base.map((n) => {
        try { return Math.max(0.05, Number(cfg.bias?.(n)) || 1) } catch { return 1 }
      })
      const total = weights.reduce((a, b) => a + b, 0)
      let r = Math.random() * total
      for (let i = 0; i < base.length; i++) { r -= weights[i]; if (r <= 0) { pick = base[i]; break } }
    }
    return start(pick, opts)
  }

  const add = (id, delta) => {
    if (!delta || !Number.isFinite(delta)) return
    bus?.add(id, delta)
  }

  function apply(dtMs = 1000 / 60) {
    const dt = clamp(dtMs / 1000, 0.001, 0.12)
    t += dt
    // 频率与播放速度分开：idleSpeed 只管「多久换一次动作」，playback 才是动作快慢。
    // 上限锁在 1（= 预设速度），再快手臂就像被瞬移。
    const rate = clamp(Number(cfg.playback) || 1, 0.4, 1)
    const paused = performance.now() < pausedUntil
    const manual = !!cur?.manual
    // 「待机」开关只管随机动作与常驻微摆；**手动点名的动作永远照播** ——
    // 关掉待机是为了桌面安静，不是为了把 agent 的动作也一起静音。
    const live = cfg.enabled && !paused

    // ① 常驻微摆：三条不同周期的正弦，看起来像不自觉的换重心
    if (live) {
      add('ParamBodyAngleX', Math.sin(t * 0.31) * cfg.swayX)
      add('ParamBodyAngleZ', Math.sin(t * 0.22 + 1.3) * cfg.swayZ)
      add('ParamAngleZ', Math.sin(t * 0.27 + 0.6) * cfg.swayHeadZ)
      add('ParamAngleY', Math.sin(t * 0.19 + 2.1) * cfg.swayHeadY)
    }

    // ② 随机调度（关了待机就只剩手动动作）
    if (!cur) {
      if (live) {
        next -= dt * cfg.speed
        if (next <= 0) trigger()
      }
    } else if (live || manual) {
      cur.t += dt * 1000 * rate        // 播放速度只作用在这里（动作轨道）
      if (cur.t >= cur.ms) {
        const done = cur
        cur = null
        try { onFinish?.(done.name, done.r) } catch {}
        if (queue.length) start(queue.shift(), { manual: done.manual })
      } else {
        const p = cur.t / cur.ms
        // 首尾各留 fade：整体乘一个钟形包络
        const fadeIn = clamp(cur.t / (cfg.fade * 1000), 0, 1)
        const fadeOut = clamp((cur.ms - cur.t) / (cfg.fade * 1000), 0, 1)
        const k = Math.min(fadeIn, fadeOut)
        // 先合成这一帧，再统一写：腿的联动要看到「胯已经转了多少」才知道该带多少
        const frame = {}
        for (const [id, keys] of Object.entries(cur.r.tracks)) {
          frame[id] = (frame[id] || 0) + sample(keys, p) * k
        }
        for (const [id, v] of Object.entries(frame)) add(id, v)
        // 联动：头转了身体/眼睛跟上，身体歪了胯找平衡（动作没显式写才补）
        if (cfg.link) for (const [id, v] of Object.entries(linkedParams(frame))) add(id, v)
        // 模型没有独立腿骨：腿只能跟着胯走，腿动了身体也要跟（见 rig.legChain）
        for (const [id, v] of Object.entries(legChain(frame))) add(id, v)
        // 手臂链：track 里写的是「相对举手族基线的偏移」，乘包络后交给 poses.tune。
        // 首尾从 0 出发再回 0，所以动作结束会平滑回到族基线。
        if (cur.r.arms && onArms) {
          const off = {}
          for (const [id, keys] of Object.entries(cur.r.arms)) off[id] = sample(keys, p) * k
          onArms(off)
        }
        // 物理输出（腿的转向/并腿、左臂Z 等）走 hold：绝对值直接写，否则会被物理回算吃掉
        for (const [id, keys] of Object.entries(cur.r.holds || {})) {
          try { onHold?.(id, sample(keys, p) * k) } catch {}
          heldIds.add(id)
        }
      }
    }
    const yielding = !cur || (!manual && !live)
    if (yielding) releaseHolds()
    if (yielding) { try { onArms?.(null) } catch {} }
  }

  return {
    apply, trigger, pause, reset, resume,
    /** 运行时开关待机动作（模型可以自己切；持久化由调用方负责） */
    setEnabled(on) { cfg.enabled = !!on; return cfg.enabled },
    routines: () => Object.keys(ROUTINES),
    /**
     * 当前动作「要抢多少头部角度」（度）：取当前动作所有 ParamAngle* 轨道的峰值绝对值。
     *
     * 为什么不是一个布尔：以前只要轨道里出现 ParamAngle* 就让位，
     * 于是「戴铁盆」这种只偏 5° 的小动作也会把鼠标追踪整段掐掉 ——
     * 表现就是「放个表情，头就不跟鼠标了」。
     * 现在按幅度分档：≤4° 完全不让位，4~12° 线性让位，≥12° 才彻底交给动作。
     */
    headLoad() {
      if (!cur) return 0
      const tr = cur.r?.tracks || {}
      let peak = 0
      for (const [id, keys] of Object.entries(tr)) {
        if (!id.startsWith('ParamAngle')) continue
        for (const [, v] of keys) {
          const a = Math.abs(Number(v) || 0)
          if (a > peak) peak = a
        }
      }
      return peak
    },
    /** 当前动作是否在写头部（兼容旧调用：只看有没有明显头部幅度） */
    headBusy() {
      return this.headLoad() > 8
    },
    /** 语义配方（情绪）名清单 —— 显式点名才播 */
    emotions: () => [...EMOTION_KEYS],
    combos: () => Object.keys(COMBOS),
    /**
     * 还没播完的**真实时长**（毫秒）：当前动作剩余 + 队列里每一拍，除以 playback。
     * 字幕/气泡的「最终时长」用它和说话时长比大小。
     */
    remaining() {
      if (!cur) return 0
      const rate = clamp(Number(cfg.playback) || 1, 0.4, 1)
      let total = Math.max(0, cur.ms - cur.t)
      for (const n of queue) total += ROUTINES[n]?.ms || 0
      return Math.round(total / rate)
    },
    /** 某个动作/组合/链 从头播完要多久（真实毫秒，含播放速度） */
    plannedMs(name) {
      if (!name) return 0
      const rate = clamp(Number(cfg.playback) || 1, 0.4, 1)
      const list = COMBOS[name] ? COMBOS[name] : String(name).includes('>') ? String(name).split('>').map((s) => s.trim()).filter(Boolean) : [name]
      return Math.round(list.reduce((sum, n) => sum + (ROUTINES[n]?.ms || 0), 0) / rate)
    },
    set(patch = {}) {
      const p = { ...patch }
      // 速度上限锁死：1 = 预设速度，再快手臂就像瞬移（手/裙子的贴图切换本来也不受这个影响）
      if (p.playback != null) p.playback = clamp(Number(p.playback) || 1, 0.4, 1)
      Object.assign(cfg, p)
    },
    options: cfg,
    /** 有没有正在演的动作（每帧调用，别让它分配对象） */
    active: () => !!cur,
    state: () => ({
      current: cur?.name ?? null,
      progress: cur ? Math.round((cur.t / cur.ms) * 100) / 100 : 0,
      queue: [...queue],
      plays,
      nextIn: Math.round(next * 10) / 10,
      paused: performance.now() < pausedUntil,
      enabled: cfg.enabled,
    }),
  }
}
