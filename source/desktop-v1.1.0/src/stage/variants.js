/**
 * 互动情绪化差分（variants）—— 同一个热区，摸十次不是同一张脸。
 *
 * 以前「部位 → 一句台词 + 一套表情」是写死的：捏脸永远 ＞＜ + 「脸要变形了！」。
 * 现在每个「部位 × 手势」有 3~4 个差分，每套带：
 *   line   台词（差分自己的，不再走 PHRASES 随机）
 *   expr   表情组（覆盖分区默认反应；不写就回落 reactions.js）
 *   mouth  嘴形偏移（覆盖 REGION_MOUTH）
 *   act    要顺带播的动作名（idle-motions 的动作或情绪配方，如「傲娇」「慌乱」）
 *   params 直接写的参数（没有对应表情名时的自定义神态，走独立 source 'variant'）
 *
 * **抽签用情绪表加权**：每个差分标一组情绪倾向（如 { 害羞: 1.2, 慌乱: 0.6 }），
 * 当前情绪越高（mood.js 累积，半衰期 ~15s），该差分被抽中的概率越大。
 * 于是「刚被摸过胯 → 再摸胯更可能抽到生气那套」，「一直摸头 → 更可能撒娇」，
 * 而不是纯随机翻车。
 *
 * 差分 id 必须唯一：抽签会排除「上一次同一个」，避免连着两下同一句。
 * 台词基调沿用 phrases.js：短、轻、嘴硬心软，别写成广播剧。
 */

export const VARIANT_TAGS = [
  '傲娇', '害羞', '生气', '撒娇', '惊讶', '得意',
  '委屈', '嫌弃', '好奇', '困倦', '慌乱', '心动',
]

/**
 * 表结构：VARIANTS[热区名][手势] = [差分...]
 * 手势只用 renderer 实际会派发的：tap（点）/ pet（摸第一步）/ down（按下，捏脸用）。
 * 没列出的组合会回落到旧路径（reactions + PHRASES），不会没反应。
 */
export const VARIANTS = {
  // —— 捏脸：按住脸拖。以前只有「鼓脸 + 脸要变形了」，现在四种脾气 ——
  左脸: { down: faceVariants('L') },
  右脸: { down: faceVariants('R') },

  // —— 额头：三态循环（表情），差分只换台词与神态 ——
  额头: {
    tap: [
      { id: 'forehead-curious', line: '咦？我脸上有东西吗？', mood: { 好奇: 1.1 }, mouth: { funnel: 0.3, form: 0.12, ms: 2000 } },
      { id: 'forehead-smug', line: '嘿嘿，点这里会变哦。', mood: { 得意: 1.0, 撒娇: 0.4 }, mouth: { form: 0.4, ms: 2000 } },
      { id: 'forehead-tsun', line: '别乱点啦，会坏掉的。', mood: { 傲娇: 0.9, 嫌弃: 0.3 }, mouth: { form: -0.2, ms: 2000 } },
    ],
  },

  // —— 头：tap 是爱心眼切换；pet 是抚摸 ——
  头: {
    tap: [
      { id: 'head-tap-happy', line: '嘿嘿，再点一下嘛。', mood: { 撒娇: 1.2, 开心: 0.8 } },
      { id: 'head-tap-tsun', line: '才、才不是喜欢被摸头呢。', mood: { 傲娇: 1.2 }, act: '傲娇' },
      { id: 'head-tap-sleepy', line: '唔…好困，别戳…', mood: { 困倦: 1.3 }, mouth: { open: 0.08, form: -0.05, ms: 2200 } },
    ],
    pet: [
      { id: 'head-pet-happy', line: '再摸就咬你哦。', mood: { 开心: 1.1, 撒娇: 0.5 }, mouth: { form: 0.3, smile: 0.3, ms: 2200 } },
      { id: 'head-pet-shy', line: '唔…再摸一会儿也不是不行。', mood: { 害羞: 1.2, 心动: 0.5 }, act: '害羞' },
      { id: 'head-pet-curious', line: '嗯？你今天怎么这么黏人。', mood: { 好奇: 1.0 }, mouth: { funnel: 0.28, ms: 2000 } },
      { id: 'head-pet-sleepy', line: '摸头…会变笨的…', mood: { 困倦: 1.1 }, mouth: { form: -0.1, open: 0.06, ms: 2400 } },
    ],
  },

  // —— 胸 ——
  胸: {
    tap: [
      { id: 'chest-tap-tsun', line: '衣服要皱了啦。', mood: { 嫌弃: 1.1, 傲娇: 0.5 } },
      { id: 'chest-tap-shy', line: '别一直戳这里…', mood: { 害羞: 1.1 }, mouth: { form: 0.15, ms: 2200 } },
      { id: 'chest-tap-angry', line: '这里不行哦，手拿开。', mood: { 生气: 1.2 }, mouth: { form: -0.4, ms: 2200 } },
    ],
    pet: [
      { id: 'chest-pet-disdain', line: '哈啊……就这？', mood: { 嫌弃: 1.3 }, expr: ['屑屑眼'], mouth: { form: -0.45, ms: 2600 } },
      { id: 'chest-pet-angry', line: '手、手拿开啦！', mood: { 生气: 1.0, 慌乱: 0.6 }, mouth: { form: -0.5, jaw: 0.1, ms: 2600 } },
      { id: 'chest-pet-fluster', line: '等、等下！别这样…', mood: { 慌乱: 1.2, 害羞: 0.5 }, expr: ['流冷汗'], mouth: { jaw: 0.2, funnel: 0.25, ms: 2400 } },
    ],
  },

  // —— 腰：tap 点，pet 挠痒（tickle 动作由 renderer 照旧起） ——
  腰: {
    tap: [
      { id: 'waist-tap-curious', line: '嗯？要量腰围吗？', mood: { 好奇: 1.1 } },
      { id: 'waist-tap-shy', line: '腰很怕痒的，别戳…', mood: { 害羞: 0.9, 慌乱: 0.4 } },
      { id: 'waist-tap-proud', line: '哼，腰很细吧。', mood: { 得意: 1.2 }, mouth: { form: 0.45, pucker: 0.15, ms: 2200 } },
    ],
    pet: [
      { id: 'waist-pet-laugh', line: '别挠啦～哈哈哈哈！', mood: { 开心: 1.3 }, mouth: { open: 0.42, form: 0.5, smile: 0.8, ms: 2800 } },
      { id: 'waist-pet-shy', line: '唔…痒痒的，别…', mood: { 害羞: 1.1 }, mouth: { open: 0.2, form: 0.2, ms: 2400 } },
      { id: 'waist-pet-angry', line: '手、手拿开啦！', mood: { 生气: 1.0 }, mouth: { open: 0.3, form: -0.3, ms: 2400 } },
    ],
  },

  // —— 裙摆：tap 切裙子，pet 嫌弃 ——
  裙摆: {
    tap: [
      { id: 'skirt-tap-panic', line: '啊！裙、裙子！', mood: { 慌乱: 1.3 }, act: '慌乱' },
      { id: 'skirt-tap-shy', line: '快、快放下来啦。', mood: { 害羞: 1.2 }, mouth: { form: 0.2, funnel: 0.2, ms: 2400 } },
      { id: 'skirt-tap-pout', line: '哼，小气鬼。', mood: { 傲娇: 1.0 }, mouth: { form: -0.25, ms: 2200 } },
    ],
    pet: [
      { id: 'skirt-pet-kill', line: '再看就把你眼珠子挖出来。', mood: { 生气: 1.3, 嫌弃: 0.6 }, expr: ['黑脸', '屑屑眼', '竖食指开'], mouth: { form: -0.55, ms: 3200 } },
      { id: 'skirt-pet-wind', line: '风、风要吹起来了——', mood: { 慌乱: 1.2 }, expr: ['流冷汗'], mouth: { jaw: 0.18, funnel: 0.2, ms: 2400 } },
      { id: 'skirt-pet-tsun', line: '不许看啦！', mood: { 傲娇: 0.9, 害羞: 0.6 }, mouth: { form: -0.2, pucker: 0.3, ms: 2400 } },
    ],
  },

  // —— 腿：tap 加载（发晕），pet 加载 + 脸红 ——
  腿: {
    tap: [
      { id: 'legs-tap-curious', line: '嗯？腿怎么了吗？', mood: { 好奇: 1.1 } },
      { id: 'legs-tap-dizzy', line: '唔…有点晕乎乎的。', mood: { 困倦: 0.9, 慌乱: 0.4 }, expr: ['圈圈眼'], mouth: { open: 0.24, funnel: 0.3, ms: 2600 } },
      { id: 'legs-tap-pout', line: '腿腿不是玩具哦。', mood: { 嫌弃: 1.0 }, mouth: { form: -0.3, ms: 2200 } },
    ],
    pet: [
      { id: 'legs-pet-tickle', line: '痒…别摸腿啦。', mood: { 害羞: 1.0, 慌乱: 0.6 }, expr: ['加载', '脸红'], mouth: { open: 0.2, form: 0.2, ms: 2400 } },
      { id: 'legs-pet-angry', line: '再摸就踢你了哦。', mood: { 生气: 1.2 }, expr: ['加载', '黑脸'], mouth: { form: -0.45, ms: 2600 } },
      { id: 'legs-pet-dizzy', line: '等、等一下…头有点晕…', mood: { 慌乱: 1.1 }, expr: ['加载', '圈圈眼', '脸红'], mouth: { open: 0.32, funnel: 0.35, ms: 2800 } },
    ],
  },

  // —— 脚：tap 脱鞋（toggle），pet 被挠痒 ——
  脚: {
    tap: [
      { id: 'foot-tap-shy', line: '很脏的…别脱呀。', mood: { 害羞: 1.2 }, expr: ['脸红'], mouth: { form: 0.1, ms: 2400 } },
      { id: 'foot-tap-panic', line: '鞋子会掉的！', mood: { 慌乱: 1.0 }, mouth: { jaw: 0.18, ms: 2200 } },
      { id: 'foot-tap-curious', line: '凉凉的…你要干嘛？', mood: { 好奇: 1.0 } },
    ],
    pet: [
      { id: 'foot-pet-laugh', line: '别挠脚心啦～哈哈哈！', mood: { 开心: 1.3 }, mouth: { open: 0.5, form: 0.55, smile: 0.85, ms: 3200 } },
      { id: 'foot-pet-shy', line: '脚、脚底不行…', mood: { 害羞: 1.2 }, mouth: { open: 0.2, form: 0.3, ms: 2400 } },
      { id: 'foot-pet-angry', line: '再挠就踹你了！', mood: { 生气: 1.0 }, mouth: { open: 0.3, form: -0.3, ms: 2400 } },
    ],
  },

  // —— 手：tap 切手型（竖手指 / 抚胸），pet 不好意思 ——
  左手: handVariants('L'),
  右手: handVariants('R'),

  // —— 胯：tap 只是轻碰，pet 才是「越界」 ——
  胯: {
    tap: [
      { id: 'crotch-tap-cold', line: '这里不行。', mood: { 生气: 1.1 }, mouth: { form: -0.4, ms: 2200 } },
      { id: 'crotch-tap-shy', line: '你、你碰哪呢…', mood: { 害羞: 1.1, 慌乱: 0.5 }, mouth: { form: 0.15, ms: 2200 } },
      { id: 'crotch-tap-warn', line: '手放老实点。', mood: { 嫌弃: 0.9, 生气: 0.5 }, mouth: { form: -0.5, ms: 2400 } },
    ],
    pet: [
      // 用户点名的两套：黑脸笑「早晚把你剁了」/ 脸红偏头「太……太快了」
      { id: 'crotch-pet-kill', line: '再敢摸，早晚把你剁了。', mood: { 生气: 1.3, 嫌弃: 0.7 }, expr: ['黑脸'], mouth: { form: -0.55, smile: -0.15, ms: 3600 }, act: '嫌弃' },
      { id: 'crotch-pet-fast', line: '太……太快了。', mood: { 慌乱: 1.2, 害羞: 0.9 }, expr: ['脸红'], mouth: { form: 0.1, pucker: 0.35, ms: 3000 }, act: '慌乱' },
      { id: 'crotch-pet-disgust', line: '你是变态吗？', mood: { 生气: 1.1 }, expr: ['黑脸', '屑屑眼'], mouth: { form: -0.5, ms: 3200 } },
      { id: 'crotch-pet-weak', line: '呜…别这样…', mood: { 委屈: 0.9, 害羞: 0.6 }, expr: ['脸红'], mouth: { form: -0.2, pucker: 0.4, ms: 3000 } },
    ],
  },

  // —— 尾巴：tap 开关；pet 是一整套甩尾反应（动作由 renderer 起，这里只换神态） ——
  尾巴: {
    tap: [
      { id: 'tail-tap-curious', line: '咦，尾巴动了？', mood: { 好奇: 1.2 } },
      { id: 'tail-tap-smug', line: '尾巴的开关在这里哦。', mood: { 得意: 1.0 }, mouth: { form: 0.35, ms: 2200 } },
      { id: 'tail-tap-warn', line: '别乱摸尾巴啦。', mood: { 傲娇: 0.9 }, mouth: { form: -0.2, ms: 2200 } },
    ],
    pet: [
      { id: 'tail-pet-tsun', line: '才、才不是想让你摸呢……', mood: { 傲娇: 1.3 }, mouth: { form: -0.3, pucker: 0.4, ms: 3200 } },
      { id: 'tail-pet-shy', line: '别乱碰啦，尾、尾巴很敏感的…', mood: { 害羞: 1.2, 慌乱: 0.5 }, mouth: { form: 0.15, funnel: 0.2, ms: 3200 } },
      { id: 'tail-pet-allow', line: '哼，就、就一下下哦。', mood: { 撒娇: 0.9, 害羞: 0.6 }, mouth: { form: 0.2, pucker: 0.3, ms: 3000 } },
      { id: 'tail-pet-deny', line: '唔…再摸一下也不是不行…才没有！', mood: { 傲娇: 0.8, 心动: 0.6 }, mouth: { form: 0.1, ms: 3200 } },
    ],
  },

  // —— 长裙：tap 换回短裙；dragEnd 提裙转身 ——
  长裙: {
    tap: [
      { id: 'longskirt-tap-cheer', line: '那就换回短裙吧。', mood: { 开心: 1.1 } },
      { id: 'longskirt-tap-shy', line: '长裙…会不会太长了呀？', mood: { 害羞: 1.0 } },
      { id: 'longskirt-tap-pout', line: '好啦好啦，换短的。', mood: { 傲娇: 0.8, 嫌弃: 0.4 } },
    ],
    dragEnd: [
      { id: 'longskirt-drag-ask', line: '好看吗？', mood: { 心动: 1.2, 害羞: 0.6 }, mouth: { form: 0.3, ms: 3000 } },
      { id: 'longskirt-drag-tsun', line: '你、你一直看裙子做什么…', mood: { 傲娇: 1.1 }, mouth: { form: -0.15, pucker: 0.3, ms: 3000 } },
      { id: 'longskirt-drag-proud', line: '哼，很适合我吧。', mood: { 得意: 1.2 }, mouth: { form: 0.45, ms: 2800 } },
    ],
  },
}

/** 捏脸：左右两张脸文案一致，id 带侧别（诊断时能分清是哪边的差分） */
function faceVariants(side) {
  return [
    { id: `pinch-${side}-squint`, line: '你就这么喜欢捏我的脸吗？', mood: { 傲娇: 1.1, 好奇: 0.5 }, expr: ['＞＜', '脸红'], mouth: { form: 0.2, smile: 0.25, ms: 2400 } },
    { id: `pinch-${side}-leak`, line: '要、要漏气了要漏气了！', mood: { 慌乱: 1.2 }, expr: ['＞＜', '流冷汗'], mouth: { jaw: 0.2, funnel: 0.2, ms: 2200 } },
    { id: `pinch-${side}-angry`, line: '再捏我真的生气了哦。', mood: { 生气: 1.2 }, expr: ['＞＜', '黑脸'], mouth: { form: -0.45, ms: 2200 } },
    { id: `pinch-${side}-soft`, line: '唔…再揉一下下也不是不行。', mood: { 撒娇: 1.1, 害羞: 0.6 }, expr: ['＞＜', '脸红'], mouth: { form: 0.3, pucker: 0.25, ms: 2400 } },
  ]
}

/** 手：左右各生成一份（id 带侧别），避免共享对象被改时串台 */
function handVariants(side) {
  return {
    tap: [
      { id: `hand-${side}-curious`, line: '嗯？怎么了？', mood: { 好奇: 1.1 } },
      { id: `hand-${side}-ask`, line: '要牵手吗？', mood: { 心动: 0.9, 害羞: 0.5 }, mouth: { form: 0.25, ms: 2200 } },
      { id: `hand-${side}-tsun`, line: '手在这里哦，别戳。', mood: { 傲娇: 0.8 } },
    ],
    pet: [
      { id: `hand-${side}-shy`, line: '嗯…暖的。', mood: { 害羞: 1.2, 心动: 0.5 }, mouth: { open: 0.12, form: 0.26, smile: 0.32, ms: 2200 } },
      { id: `hand-${side}-hold`, line: '要握紧吗？', mood: { 撒娇: 1.0 }, mouth: { form: 0.3, ms: 2200 } },
      { id: `hand-${side}-fluster`, line: '手、手不会跑啦。', mood: { 慌乱: 0.9, 害羞: 0.4 }, mouth: { form: 0.1, ms: 2200 } },
    ],
  }
}

/**
 * 单条差分的抽签权重。
 * base × Π(1 + boost × 当前该情绪值)：情绪为 0 时退化成 base，情绪高时成倍放大。
 */
export function weightOf(variant, mood = {}) {
  const base = Number(variant.weight) > 0 ? Number(variant.weight) : 1
  let k = base
  for (const [tag, boost] of Object.entries(variant.mood || {})) {
    const val = Number(mood?.[tag]) || 0
    if (val > 0) k *= 1 + boost * val
  }
  return k
}

/** 列出某组合的差分（诊断 / 文档用） */
export function variantsOf(key, gesture) {
  return VARIANTS[key]?.[gesture] || []
}

/**
 * 注册 / 覆盖差分（扩展用，见 docs/EXTENDING.md）。
 *   同 id = 覆盖字段（只写要改的项，其余保留）；新 id = 追加到该组合末尾。
 * 返回实际生效的「部位·手势·id」清单，方便扩展自己打日志。
 */
export function registerVariants(patch = {}) {
  const touched = []
  for (const [key, byKind] of Object.entries(patch)) {
    if (!byKind || typeof byKind !== 'object') continue
    VARIANTS[key] = VARIANTS[key] || {}
    for (const [kind, list] of Object.entries(byKind)) {
      if (!Array.isArray(list)) continue
      const cur = VARIANTS[key][kind] || (VARIANTS[key][kind] = [])
      for (const v of list) {
        if (!v || !v.id) continue
        const i = cur.findIndex((x) => x.id === v.id)
        if (i >= 0) cur[i] = { ...cur[i], ...v }
        else cur.push(v)
        touched.push(`${key}·${kind}·${v.id}`)
      }
    }
  }
  return touched
}

/** 导出全部差分（扩展写工具页 / 诊断用；返回的是副本，改它不会影响实际抽签） */
export function listVariants() {
  const out = {}
  for (const [key, byKind] of Object.entries(VARIANTS)) {
    out[key] = Object.fromEntries(Object.entries(byKind).map(([g, list]) => [g, list.map((v) => ({ ...v }))]))
  }
  return out
}

/**
 * 抽签器：记住每个组合上一次抽中的 id，下一把排除它（剩最后一个时允许重复）。
 * `mood` 传函数，每次抽签实时读当前情绪（不要传快照，否则半衰期内不更新）。
 */
export function createVariantPicker({ mood = () => ({}), random = Math.random } = {}) {
  const last = new Map()

  function pick(key, gesture) {
    const list = variantsOf(key, gesture)
    if (!list.length) return null
    const slot = `${key}:${gesture}`
    const lastId = last.get(slot)
    let pool = list
    if (list.length > 1 && lastId) {
      const rest = list.filter((v) => v.id !== lastId)
      if (rest.length) pool = rest
    }
    const now = mood() || {}
    const weights = pool.map((v) => weightOf(v, now))
    let total = 0
    for (const w of weights) total += w
    let chosen = pool[pool.length - 1]
    if (total > 0) {
      let r = random() * total
      for (let i = 0; i < pool.length; i++) {
        r -= weights[i]
        if (r <= 0) { chosen = pool[i]; break }
      }
    }
    last.set(slot, chosen.id)
    return chosen
  }

  return {
    pick,
    last: (key, gesture) => last.get(`${key}:${gesture}`) || null,
    /** 诊断：当前权重表（看看情绪把谁顶上来了） */
    debug(key, gesture) {
      const now = mood() || {}
      return variantsOf(key, gesture).map((v) => ({
        id: v.id,
        weight: Math.round(weightOf(v, now) * 100) / 100,
      }))
    },
    reset() { last.clear() },
  }
}
