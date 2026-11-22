/**
 * Agent 意图协议 —— 固定词表 + 分隔符块。
 *
 * 为什么不让 AI 直接写参数：
 *   模型有 509 个参数、能动的大约 20 个，而「手抬到下巴」这种意思在参数空间里
 *   根本不存在（只有肩/大臂/小臂/手腕四个角度）。让模型现场反解 IK，等于让盲人画画。
 *   所以给它的接口必须是**意图**（姿势/看哪/什么表情），参数由本机求解器填。
 *
 * 为什么不走 JSON：
 *   实测 LLM 在自然语言里夹 JSON 时，引号、括号、换行最容易崩；而 `|` 分隔没有转义地狱，
 *   还能和正文混排（正文是台词，块是动作）。代价是词表必须封闭 —— 这正是我们要的：
 *   词表外的动词直接报错回执，模型下一轮自己改。
 *
 * 语法：
 *   【动词|参数|参数|…】      多个块可连写；块外的文字 = 她说的话
 *   [[动词|参数|参数|…]]      ASCII 兜底（模型偶尔不打全角括号）
 *
 * 纯函数：不碰 DOM、不碰引擎，方便单测（见 tmp/intent-test.mjs）。
 */

/** 词表：动词 → 参数说明。参数位置固定，`?` 表示可省。 */
export const VERBS = {
  姿势: { en: 'pose', args: ['名字', 'ms?'], help: '竖手指 / 举手 / 狗尾草 / 默认手' },
  手势: { en: 'gesture', args: ['名字'], help: '摸下巴 / 打招呼 / 捧胸 / 垂手 / 捂嘴 / 托腮 / 侧平举 / 半平举 / 高举（姿势族 + 联动自动补全）' },
  动作: { en: 'act', args: ['名字?'], help: '成套动作：捂嘴偷笑 / 托腮 / 半平举 / 高举 / 挥手打招呼 / 杂鱼晃手 / 扭腰 / 护胸防御。省略名字 = 列清单' },
  情绪: { en: 'emotion', args: ['名字?'], help: '语义配方（头/眼/眉/嘴 + 耳转/扑棱 + 表情 一起上）：傲娇 / 害羞 / 生气 / 撒娇 / 惊讶 / 得意 / 委屈 / 嫌弃 / 好奇 / 困倦 / 慌乱 / 心动。省略名字 = 列清单' },
  手: { en: 'hand', args: ['左/右', '开/关'], help: '左手竖食指、右手抚胸，各自独立' },
  表情: { en: 'expression', args: ['表情名', 'ms?'], help: '模型自带的表达式名（见 capabilities）' },
  看: { en: 'look', args: ['目标'], help: '鼠标 / 上 / 下 / 左 / 右 / 正前 / <x> <y>（-1..1）' },
  换裙: { en: 'skirt', args: ['长/短'], help: '长裙会收起腿热区、自动换成长裙热区' },
  尾巴: { en: 'tail', args: ['开/关'], help: '关掉尾巴会浮出蓝鲸找回气泡' },
  转身: { en: 'sway', args: ['幅度?'], help: '1-30，默认 16：身体左右轻转一下' },
  说: { en: 'say', args: ['台词', 'ms?'], help: '让她说一句（正文外的文字也是台词）' },
  停: { en: 'stop', args: ['表情/姿势/全部?'], help: '停掉外部指令留下的状态' },
}

const ALIAS = new Map()
for (const [zh, def] of Object.entries(VERBS)) {
  ALIAS.set(zh, zh)
  ALIAS.set(def.en, zh)
}

/** 全角【】 + ASCII [[]] 两种块；一个字符串里可以混多个 */
const BLOCK_RE = /【([^】]*)】|\[\[([^\]]*)\]\]/g

const isNum = (s) => s !== '' && /^-?\d+(\.\d+)?$/.test(s)

/**
 * 把一段文本拆成「台词 + 意图列表」。
 * @returns {{ text: string, intents: Array<{verb:string,args:string[],raw:string}>, errors: Array<{raw:string,error:string}> }}
 */
export function parseIntents(input) {
  const raw = String(input ?? '')
  const intents = []
  const errors = []
  let text = ''
  let last = 0
  for (const m of raw.matchAll(BLOCK_RE)) {
    text += raw.slice(last, m.index)
    last = m.index + m[0].length
    const body = String(m[1] ?? m[2] ?? '').trim()
    if (!body) continue
    const parts = body.split('|').map((s) => s.trim())
    const rawVerb = parts.shift() || ''
    const verb = ALIAS.get(rawVerb) || ALIAS.get(rawVerb.toLowerCase())
    if (!verb) {
      errors.push({ raw: body, error: `未知指令「${rawVerb}」` })
      continue
    }
    // 「说」的台词本身可能带 |：最后一个纯数字参数当 ms，其余按 | 拼回来
    let args = parts
    if (verb === '说' && args.length > 1) {
      const tail = args[args.length - 1]
      const ms = tail.startsWith('ms=') ? tail.slice(3) : tail
      // 台词里允许出现 |：最后一个纯数字参数当 ms，其余按 | 拼回一句
      if (isNum(ms)) args = [args.slice(0, -1).join('|'), ms]
      else args = [args.join('|')]
    }
    intents.push({ verb, args, raw: body })
  }
  text += raw.slice(last)
  return { text: text.replace(/\s+/g, ' ').trim(), intents, errors }
}

/** 给 agent 的系统提示用：一行一个动词，尽量短 */
export function grammarText() {
  const lines = Object.entries(VERBS).map(([zh, d]) => `【${zh}|${d.args.join('|')}】  ${d.help}`)
  return [
    '动作指令：写成【动词|参数|…】，块外的文字才会被念出来。可连写多个块。',
    ...lines,
  ].join('\n')
}

/** 数值夹板：外部输入一律不信任 */
export const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}
