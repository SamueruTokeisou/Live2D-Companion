/**
 * 骨架层（rig）—— 在 Live2D 参数之上抽象出「骨骼」「手位」与「手势」。
 *
 * 实测结论（重要，决定了整个设计）：
 *   这个模型是**换图式骨架**，不是一套连续骨架。四条手臂美术各自独立：
 *     · 默认手    —— 双臂垂在体侧，几乎不能动（RArm/RForearm/RWrist ±1 只有 ~130px 行程）
 *     · 举手族    —— Param59/60/61/62 能在很大范围里连续摆：捂嘴 / 托腮 / 侧平举 / 半平举 / 高举
 *     · 竖指族    —— 食指朝上，位置固定，Param44 + LWrist 只能晃
 *     · 狗尾草    —— 拿着一根草贴在脸旁
 *   所以「手抬到下巴」「手挡在裙前」这类跨族目标，只能靠**换族 + 族内求解**，
 *   或者二次分层（见 docs/SPEC.md 的「挡胯」条目）。真 IK 不存在。
 *
 * 三点标定（tmp/scan-*.json 实测，模型坐标）：
 *   手位锚点 = 举手族里 Param62/60/59 的一组落点，覆盖「脸前 → 侧平举 → 高举」整段。
 *
 * 分层：
 *   bone  = 姿势族（离散，决定「哪套图」）
 *   joint = 族内连续参数（举手臂链），手势就是在这层插值
 *   连锁（LINKAGE）挂在 joint 上：动一根骨按增益带起相邻骨，最后交给模型自带物理收尾。
 */

/** 骨骼树：每根骨 → 它真正写的参数。左右按**画面**分（模型美术是这么做的）。 */
const BONES = {
  pelvis: { params: ['HipAngleX', 'HipAngleY', 'HipAngleZ'] },
  // 腿：这个模型没有膝盖/脚踝参数。LEGAngleZ2（双腿一起转）和 Param33（并/分腿）
  // 实测都是**物理输出**：写它们会被下一帧物理回算吃掉，只能靠 hold 在物理之后写绝对值；
  // 常规做法是「动胯」，腿由物理带着走（见 legChain）。
  legs: { params: ['LEGAngleZ2', 'Param33'] },
  spine: { params: ['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'] },
  shoulder: { params: ['ShoulderX', 'ShoulderY', 'ShoulderZ', 'ShoulderYy'] },
  // 「屏幕上左边那只手」的举手臂链
  armL: { params: ['Param62', 'Param59', 'Param60', 'Param61'] },
  // 「屏幕上右边那只手」的连续链（行程很小，只能微调）
  armR: { params: ['LArm', 'LForearm', 'LWrist'] },
  head: { params: ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'] },
  eyes: { params: ['ParamEyeBallX', 'ParamEyeBallY'] },
}

/**
 * 手位锚点：**相对举手族基线的偏移量**（poses.tune 用的同语义）。
 * 数值来自 tmp/scan-raise3 的逐 drawable 包围盒标定 + tmp/pface2 的截图确认：
 *   62 越小手越往脸中间靠，59 越大越贴脸，60 越小越往上收。
 * 注意：这里是偏移，不是绝对值 —— 曾把两者搞混，结果「捂嘴」变成了手臂垂到裙前。
 */
const ARM_REACH = {
  胸前: { Param62: 0, Param59: 0, Param60: 0, },
  捂嘴: { Param62: -1, Param59: 1, Param60: 0 },
  托腮: { Param62: -0.5, Param59: 1, Param60: 0 },
  侧平举: { Param62: 0.5, Param59: 0, Param60: -0.5 },
  半平举: { Param62: 1, Param59: 0, Param60: 0.5 },
  高举: { Param62: 1, Param59: -1, Param60: -0.5 },
  护胸: { Param62: -0.5, Param59: 0, Param60: 0 },
}

/** 举起那只手时，肩/躯干该跟着补多少（不然像「手脱臼」） */
const ARM_LINKAGE = {
  // 手位 → 肩补偿（举得越高，肩越提）
  捂嘴: { ShoulderY: 1.6, ShoulderZ: -1.2 },
  托腮: { ShoulderY: 1.2, ShoulderZ: -1.0 },
  侧平举: { ShoulderY: 2.0, ShoulderZ: 1.4 },
  半平举: { ShoulderY: 1.4, ShoulderZ: 1.0 },
  高举: { ShoulderY: 3.0, ShoulderZ: 2.2 },
}

/**
 * 从「举手链的当前偏移」推肩/躯干补偿（每帧求值，纯函数）。
 * 62 越小、59 越大 = 手越往脸/上方收 → 肩越提、胸口略侧；
 * 62 越大 = 手往侧外展 → 肩往前送一点。
 * @param {object} off poses.tuneState() / 动作 arms 偏移
 */
export function armLinkageFromTune(off = {}) {
  const a = Number(off.Param62) || 0      // -1..1
  const b = Number(off.Param59) || 0
  const lift = Math.max(-1.5, Math.min(2.5, -a * 1.4 + b * 0.8))
  return {
    ShoulderY: lift,
    ShoulderZ: a * 1.0,
    ParamBodyAngleZ: -a * 1.2,
  }
}

/**
 * 胯 → 腿 → 身体 的父子联动。
 *
 * 实测（traceWrite + 逐帧读数）：**LEGAngleZ2 和 Param33 都是物理输出**（isOut、不是 isIn）。
 * 也就是说它们是物理引擎**算出来**的，我们往总线上写会被下一帧物理回算吃掉 ——
 * 腿根本不是「能直接摆」的骨头，它挂在胯上跟着走。所以这里不写腿，只做两件事：
 *   ① 身体跟随：胯/腿一转，躯干和重心跟着回一点，不然只有下半身在动；
 *   ② 并腿时重心下沉一点（ParamBodyAngleY）。
 * 真要「手动摆腿」（例如跺脚），必须走 `holds`（物理之后写绝对值），见 idle-motions。
 * @param {object} frame 该帧动作的合成值（HipAngleZ / ParamBodyAngleZ）
 */
export function legChain(frame = {}) {
  const num = (v) => Number(v) || 0
  const hip = num(frame.HipAngleZ)
  const bodyZ = num(frame.ParamBodyAngleZ)
  const leg = hip * 0.9 + bodyZ * 0.4   // 物理大概会把腿带到这个角度（只用于算身体补偿）
  const out = {}
  if (leg) {
    out.ParamBodyAngleZ = leg * 0.12
    out.ParamBodyAngleX = leg * 0.06
  }
  const split = num(frame.Param33)
  if (split) out.ParamBodyAngleY = -Math.abs(split) * 1.8
  return out
}


/**
 * 联动手册：源骨 → 派生骨（增益 + 延迟 ms）。
 * 头→身取 0.15~0.3，臂→肩取 0.12，都是调研报告的常用区间（见 docs/SPEC.md §5.6）。
 */
const LINKAGE = [
  { from: 'armL', to: 'shoulder', gain: { ShoulderY: 0.12, ShoulderZ: -0.08 }, delay: 40 },
  { from: 'armL', to: 'spine', gain: { ParamBodyAngleZ: -0.06 }, delay: 90 },
  { from: 'armR', to: 'shoulder', gain: { ShoulderY: 0.12, ShoulderZ: 0.08 }, delay: 40 },
  { from: 'armR', to: 'spine', gain: { ParamBodyAngleZ: 0.06 }, delay: 90 },
  { from: 'head', to: 'spine', gain: { ParamBodyAngleY: 0.15 }, delay: 60 },
]

/** 手势 → 姿势族 + 手位锚点 + 头/身微调 */
const GESTURES = {
  摸下巴: { family: '竖指', reach: null, tune: { head: { ParamAngleZ: 6, ParamAngleY: -4 } } },
  打招呼: { family: '竖指', reach: null, tune: { spine: { ParamBodyAngleZ: -3 }, head: { ParamAngleY: -6 } } },
  捧胸: { family: '抚胸', reach: null, tune: { head: { ParamAngleY: 5 } } },
  垂手: { family: '垂手', reach: null, tune: {} },
  捂嘴: { family: '举手', reach: '捂嘴', tune: { head: { ParamAngleZ: 3, ParamAngleY: -2 } } },
  托腮: { family: '举手', reach: '托腮', tune: { head: { ParamAngleZ: 5, ParamAngleX: -3 } } },
  侧平举: { family: '举手', reach: '侧平举', tune: { head: { ParamAngleZ: -2 } } },
  半平举: { family: '举手', reach: '半平举', tune: {} },
  高举: { family: '举手', reach: '高举', tune: { head: { ParamAngleY: 4 } } },
}

/** 姿势族：离散的「哪套图」。名字与模型自带的姿势预设一致，
 *  由 poses.js 负责切换（它同时管手臂链的固定参数）。 */
const POSE_FAMILIES = {
  垂手: '默认手',
  竖指: '竖手指',
  抚胸: '举手',
  狗尾草: '狗尾草',
  举手: '举手',
}

/**
 * 把「手势 + 微调」展平成要写的参数层。
 * @param {string} name
 * @param {object} [base] 当前族的落点（poses.armBase()），给了才能算出手臂微调量
 * @returns {{family:string|null, reach:object|null, params:Array, error:string|null}}
 */
export function planGesture(name, base = null) {
  const g = GESTURES[name]
  if (!g) return { family: null, reach: null, params: [], error: `没有这个手势：${name}` }
  const params = []
  for (const [bone, kv] of Object.entries(g.tune || {})) {
    if (!BONES[bone]) continue
    for (const [id, v] of Object.entries(kv)) params.push({ id, value: v, blend: 'Add' })
  }
  // 联动：微调骨动多少，相邻骨按增益补一点，形成「链」
  for (const rule of LINKAGE) {
    const src = g.tune?.[rule.from]
    if (!src) continue
    for (const [id, gain] of Object.entries(rule.gain)) {
      const srcVal = Object.values(src)[0] || 0
      if (!srcVal) continue
      params.push({ id, value: srcVal * gain, blend: 'Add' })
    }
  }
  // 手位：锚点本身就是「相对族基线的偏移」，直接叠上去
  let reach = null
  if (g.reach && ARM_REACH[g.reach]) {
    reach = { ...ARM_REACH[g.reach] }
    for (const [id, v] of Object.entries(reach)) {
      if (v) params.push({ id, value: v, blend: 'Add' })
    }
  }
  return { family: POSE_FAMILIES[g.family] || '默认手', reach, params, error: null }
}

/** 手势名清单（对外只暴露名字，扩展/目录用；别直接改 GESTURES） */
export const GESTURE_NAMES = Object.keys(GESTURES)
