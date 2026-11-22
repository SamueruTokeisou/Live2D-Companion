/**
 * 语义配方 —— 一个「情绪」= 一整套主次通道的组合，而不是改一个表情。
 *
 * 为什么需要：模型自带 23 个表情，大半是功能性的（体型 / 裙子 / 尾巴），
 * 真正能表达情绪的就 脸红 / 流泪 / 爱心眼 / 屑屑眼 / 圈圈眼 / 流冷汗 六个。
 * 让 agent 临场写参数，等于每次重新绑骨；所以把「傲娇」这种语义固化成配方：
 *
 *   主通道（头/眼/眉/嘴/身）决定「是什么情绪」；
 *   次通道（耳朵扑棱 + Flip 转动 / 表情）决定「有多生动」。
 *
 * 配方会被 idle-motions 转成关键帧动作（首尾归零、带包络），
 * 所以 `【情绪|傲娇】` 和 `【动作|傲娇】` 等价，也能进组合连拍。
 *
 * 数值约定：头/身体是**角度增量**（度），眼开合是**增减量**（负=半闭），
 * 眉/嘴是 [-1,1] 归一量，耳扑棱是 'L' | 'R' | 'B'（两只一起）。
 */

/** 关键帧模板：快速起、保持、缓慢收（0.18 / 0.72 两个拐点） */
const keys = (v) => [[0, 0], [0.18, v], [0.72, v * 0.92], [1, 0]]

/** 一个配方 → idle-motions 能播的 routine */
export function emotionRoutine(spec = {}) {
  const tracks = {}
  const put = (map) => {
    for (const [id, v] of Object.entries(map || {})) if (v) tracks[id] = keys(v)
  }
  put(spec.head)
  put(spec.body)
  put(spec.brow)
  // 眼开合是「乘性」参数（0..1.5）：这里给增减量，负值 = 半闭，正值 = 睁大
  if (spec.eyes) {
    tracks.ParamEyeLOpen = keys(spec.eyes)
    tracks.ParamEyeROpen = keys(spec.eyes)
  }
  const r = {
    ms: spec.ms || 2600,
    lines: spec.lines || [],
    lineChance: spec.lineChance ?? 0.5,
    tracks,
  }
  if (spec.mouth) r.mouth = spec.mouth
  if (spec.expr) r.exprs = [spec.expr]
  if (spec.pose) r.pose = spec.pose
  if (spec.flap) { r.flap = spec.flap; r.flapAmp = spec.flapAmp ?? 0.8 }
  return r
}

/**
 * 情绪库。每条都刻意保持「主通道明确 + 次通道克制」——
 * 幅度一大就变鬼脸，小动作才是生动的来源。
 */
export const EMOTIONS = {
  傲娇: {
    ms: 2800,
    head: { ParamAngleX: -10, ParamAngleY: 7, ParamAngleZ: 8 },
    body: { ParamBodyAngleZ: -3.5, ParamBodyAngleX: 1.5 },
    eyes: -0.45,
    brow: { ParamBrowLY: -0.18, ParamBrowRY: 0.28 },
    mouth: { form: -0.32, pucker: 0.42, jaw: 0.03 },
    expr: '脸红',
    flap: 'L',
    flapAmp: 0.7,
    lines: ['哼，才不是……', '才、才没有在等你呢。', '别、别误会了。'],
  },
  害羞: {
    ms: 2400,
    head: { ParamAngleX: -6, ParamAngleY: -4, ParamAngleZ: 5 },
    body: { ParamBodyAngleY: -1.5 },
    eyes: -0.4,
    brow: { ParamBrowLY: 0.2, ParamBrowRY: 0.15 },
    mouth: { form: 0.2, funnel: 0.25, pucker: 0.2 },
    expr: '脸红',
    flap: 'B',
    flapAmp: 0.55,
    lines: ['唔……', '别看了啦。'],
  },
  生气: {
    ms: 2400,
    head: { ParamAngleX: 4, ParamAngleY: -6, ParamAngleZ: -4 },
    body: { ParamBodyAngleZ: 3, ParamBodyAngleX: -1.5 },
    eyes: -0.18,
    brow: { ParamBrowLY: -0.5, ParamBrowRY: -0.5 },
    mouth: { form: -0.5, jaw: 0.12, pucker: 0.15 },
    flap: 'R',
    flapAmp: 0.9,
    lines: ['哼！不理你了。', '太过分了！'],
  },
  撒娇: {
    ms: 2800,
    head: { ParamAngleX: -8, ParamAngleY: 5, ParamAngleZ: 6 },
    body: { ParamBodyAngleX: 3, ParamBodyAngleZ: -3 },
    eyes: -0.3,
    mouth: { form: 0.35, pucker: 0.32 },
    expr: '爱心眼',
    flap: 'L',
    flapAmp: 0.6,
    lines: ['就一下下嘛～', '拜托啦拜托啦。'],
  },
  惊讶: {
    ms: 1800,
    head: { ParamAngleY: -8, ParamAngleX: 3 },
    eyes: 0.3,
    brow: { ParamBrowLY: 0.5, ParamBrowRY: 0.5 },
    mouth: { open: 0.05, jaw: 0.45, funnel: 0.2 },
    expr: '圈圈眼',
    flap: 'B',
    flapAmp: 1.1,
    lines: ['诶？！', '什、什么？！'],
  },
  得意: {
    ms: 2400,
    head: { ParamAngleY: 6, ParamAngleZ: -5 },
    body: { ParamBodyAngleX: 2 },
    eyes: -0.25,
    brow: { ParamBrowRY: 0.35 },
    mouth: { form: 0.5, pucker: 0.12 },
    expr: '兔牙',
    flap: 'R',
    flapAmp: 0.7,
    lines: ['哼哼～', '本鲸当然厉害啦。'],
  },
  委屈: {
    ms: 2600,
    head: { ParamAngleY: -5, ParamAngleZ: 3 },
    eyes: -0.35,
    brow: { ParamBrowLY: 0.35, ParamBrowRY: 0.35 },
    mouth: { form: -0.35, pucker: 0.5 },
    expr: '流泪',
    lines: ['才没有哭……', '鼻子好酸。'],
  },
  嫌弃: {
    ms: 2200,
    head: { ParamAngleX: 8, ParamAngleY: -2, ParamAngleZ: -6 },
    eyes: -0.5,
    brow: { ParamBrowRY: -0.28 },
    mouth: { form: -0.42, pucker: 0.18 },
    expr: '屑屑眼',
    flap: 'R',
    flapAmp: 0.4,
    lines: ['哈啊……', '就这？'],
  },
  好奇: {
    ms: 2200,
    head: { ParamAngleX: 6, ParamAngleY: 3, ParamAngleZ: 4 },
    eyes: 0.15,
    brow: { ParamBrowLY: 0.25 },
    mouth: { funnel: 0.35, form: 0.1 },
    flap: 'L',
    flapAmp: 0.8,
    lines: ['咦？', '那是什么呀？'],
  },
  困倦: {
    ms: 3200,
    head: { ParamAngleY: -8, ParamAngleZ: 2 },
    body: { ParamBodyAngleY: -2.5 },
    eyes: -0.7,
    mouth: { open: 0.12, form: -0.05 },
    flap: 'B',
    flapAmp: 0.25,
    lines: ['唔……好困。', '就眯一下……'],
  },
  慌乱: {
    ms: 2200,
    head: { ParamAngleX: -4, ParamAngleZ: -7, ParamAngleY: 2 },
    body: { ParamBodyAngleX: -2, ParamBodyAngleZ: 2 },
    eyes: 0.2,
    brow: { ParamBrowLY: 0.4, ParamBrowRY: 0.4 },
    mouth: { jaw: 0.22, form: -0.15, funnel: 0.3 },
    expr: '流冷汗',
    flap: 'B',
    flapAmp: 1.2,
    lines: ['等、等一下！', '不不是那样的！'],
  },
  心动: {
    ms: 2600,
    head: { ParamAngleY: 3, ParamAngleZ: 3, ParamAngleX: -3 },
    eyes: -0.28,
    brow: { ParamBrowLY: 0.22, ParamBrowRY: 0.22 },
    mouth: { form: 0.45, pucker: 0.25 },
    expr: '爱心眼',
    flap: 'B',
    flapAmp: 0.5,
    lines: ['……笨蛋。', '心跳好快。'],
  },
}

/** 名字清单（给 intent / 工具回执） */
export const EMOTION_NAMES = Object.keys(EMOTIONS)
