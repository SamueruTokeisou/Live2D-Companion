/**
 * 口型（viseme）—— 把「要显示的文本」翻译成一条嘴部时间轴。
 *
 * 为什么需要它：
 *   模型 model3.json 的 LipSync 组是空的，嘴没有任何驱动源；原来气泡只是「随机音节」
 *   （mouth.js 的 talk()），跟实际念的字没关系，停顿也全靠猜。
 *   这里把文本拆成音节 → 元音口型 → 时长，得到：
 *     · 每个瞬间该张多大、嘴角往哪、要不要圆唇；
 *     · 整句该念多久（气泡停留 / 字幕保持时间就用它）。
 *
 * 发音表（三类语言，都是规则 + 现成数据，不手抄）：
 *   中文 —— pinyin-pro 取拼音与声调，再按韵母归到 a/i/u/e/o；
 *   日语 —— 假名五十音按行归到 5 元音，长音/促音/拗音单独计时；
 *   英文 —— 字母级近似（英文拼写与发音本来就不一一对应，这里只求「像在说」）。
 *
 * 依赖路径写成相对 node_modules：浏览器里没有 importmap 也能加载，
 * 免得每个验证台页面都要补一条映射。
 */
import { pinyin } from '../../../node_modules/pinyin-pro/dist/esm/index.mjs'

/** 五个口型：张合、嘴角、圆唇 */
const VISEMES = {
  a: { open: 0.9, form: 0.18, round: 0 },
  i: { open: 0.32, form: 0.55, round: 0 },
  u: { open: 0.28, form: -0.25, round: 0.85 },
  e: { open: 0.55, form: 0.12, round: 0.1 },
  o: { open: 0.62, form: -0.35, round: 0.7 },
  /** 闭口（m / b / p 的起始、促音、停顿） */
  m: { open: 0.04, form: 0, round: 0.1 },
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/**
 * 语速表 —— **最终时长由这张表决定**，不是「字数 ÷ 固定 cps」。
 *
 * 基准值来自自然语流的平均音节时长（普通话单音节约 200ms、日语一拍约 150ms、
 * 英语按字母近似的口语速率），再乘用户/情绪给的 `rate` 倍数。
 * 单位：毫秒。
 */
const SPEECH_RATE = {
  zh: {
    syllable: 200,          // 普通话一个音节
    onset: 62,              // 声母段（起手要闭一下 → 口型是 m/i/e）
    tone: { 1: 1, 2: 1.06, 3: 1.18, 4: 0.94, 0: 1 },   // 三声拖、四声干脆
  },
  ja: {
    syllable: 150,          // 一拍（mora）
    choon: 1.55,            // 长音「ー」= 拖长上一拍
    sokuon: 105,            // 促音「っ」= 短促停顿
    small: 0.62,            // 拗音小字（ゃゅょ）不到一拍
  },
  en: {
    consonant: 85,
    vowel: 110,
    longVowel: 1.3,
    wordGap: 70,            // 词间空格
  },
  digit: { syllable: 145 },
  other: { unit: 55 },      // 表情符号等
  punct: { '，': 160, ',': 160, '、': 140, '；': 200, ';': 200, '：': 160, ':': 160, '。': 300, '.': 300, '！': 300, '!': 300, '？': 300, '?': 300, '…': 260, '\n': 220, ' ': 60 },
}

/** 名字化的语速档：数值是**时长倍率**（1 = 正常，越大越慢，越小越快） */
const SPEECH_RATES = { slow: 1.3, normal: 1, fast: 0.82 }

/** 中文韵母 → 元音（按拼音拼写判，先判复韵母再判单元音） */
function zhVowel(syl = '') {
  const s = String(syl).toLowerCase().replace(/\d/g, '')
  if (/iu/.test(s)) return 'i'
  if (/ui/.test(s)) return 'u'
  if (/ao/.test(s)) return 'a'
  if (/ou/.test(s)) return 'o'
  if (/ai/.test(s)) return 'a'
  if (/ei/.test(s)) return 'e'
  if (/a/.test(s)) return 'a'
  if (/o/.test(s)) return 'o'
  if (/e/.test(s)) return 'e'
  if (/i/.test(s)) return 'i'
  if (/u|v/.test(s)) return 'u'
  if (/n/.test(s)) return 'i'     // 嗯 / 呣这类纯鼻音
  return 'e'
}

/** 中文声母：决定起手要不要先闭一下（b/p/m 最明显） */
const ZH_ONSET = {
  m: 'm', b: 'm', p: 'm', f: 'e',
  d: 'e', t: 'e', n: 'e', l: 'e',
  g: 'e', k: 'e', h: 'e',
  j: 'i', q: 'i', x: 'i',
  zh: 'i', ch: 'i', sh: 'i', r: 'i', z: 'i', c: 'i', s: 'i',
}

/** 假名 → 元音（五十音按行） */
const KANA_ROW = {
  あ: 'a', か: 'a', さ: 'a', た: 'a', な: 'a', は: 'a', ま: 'a', や: 'a', ら: 'a', わ: 'a', が: 'a', ざ: 'a', だ: 'a', ば: 'a', ぱ: 'a',
  い: 'i', き: 'i', し: 'i', ち: 'i', に: 'i', ひ: 'i', み: 'i', り: 'i', ぎ: 'i', じ: 'i', ぢ: 'i', び: 'i', ぴ: 'i',
  う: 'u', く: 'u', す: 'u', つ: 'u', ぬ: 'u', ふ: 'u', む: 'u', ゆ: 'u', る: 'u', ぐ: 'u', ず: 'u', づ: 'u', ぶ: 'u', ぷ: 'u',
  え: 'e', け: 'e', せ: 'e', て: 'e', ね: 'e', へ: 'e', め: 'e', れ: 'e', げ: 'e', ぜ: 'e', で: 'e', べ: 'e', ぺ: 'e',
  お: 'o', こ: 'o', そ: 'o', と: 'o', の: 'o', ほ: 'o', も: 'o', よ: 'o', ろ: 'o', を: 'o', ご: 'o', ぞ: 'o', ど: 'o', ぼ: 'o', ぽ: 'o',
  ん: 'm', っ: 'm', ー: 'u',
}
/** 拗音小字：只用半拍，跟前一拍合成一个音 */
const SMALL_KANA = { ゃ: 'a', ゅ: 'u', ょ: 'o', ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' }

/** 英文近似：字母 → 口型 */
const EN_LETTER = {
  a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i',
  b: 'm', p: 'm', m: 'm', f: 'e', v: 'e',
  d: 'e', t: 'e', n: 'e', l: 'e', r: 'e', s: 'i', z: 'i', c: 'i', k: 'e', g: 'e', h: 'a', j: 'i', q: 'u', w: 'u', x: 'i',
}
const EN_VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

/** 数字按中文念法取口型 */
const DIGIT_VISEME = { '0': 'i', '1': 'i', '2': 'e', '3': 'a', '4': 'i', '5': 'u', '6': 'i', '7': 'i', '8': 'a', '9': 'i' }

const isHan = (ch) => /[\u4e00-\u9fff]/.test(ch)
const isKana = (ch) => /[\u3040-\u30ff]/.test(ch)
const isLatin = (ch) => /[A-Za-z]/.test(ch)
const isDigit = (ch) => ch >= '0' && ch <= '9'
const isPunct = (ch) => ch in SPEECH_RATE.punct

/** rate 参数：可以是档名（slow/normal/fast）也可以是时长倍率（>1 = 更慢） */
function normalizeRate(rate) {
  if (typeof rate === 'string') return SPEECH_RATES[rate] ?? 1
  const n = Number(rate)
  return Number.isFinite(n) && n > 0 ? clamp(n, 0.5, 2.2) : 1
}

/** 相邻同口型合并（否则「啊啊」「哈哈」这种会一格一格抖） */
function coalesce(units) {
  const out = []
  for (const u of units) {
    const p = out[out.length - 1]
    if (p && p.viseme === u.viseme && p.start + p.ms === u.start) p.ms += u.ms
    else out.push({ ...u })
  }
  return out
}

/**
 * 文本 → 音节单元（带时长）。
 * @param {string} text
 * @param {{rate?:number|'slow'|'normal'|'fast'}} [opts]
 * @returns {{units: Array<{ch:string, viseme:string, ms:number, start:number}>, totalMs:number, rate:number}}
 */
export function planSpeech(text, opts = {}) {
  const s = String(text ?? '')
  const rate = normalizeRate(opts.rate)
  const R = SPEECH_RATE

  // ① 连续中文一次取拼音（带声调数字，用于语速表的三声/四声修正）
  const hanRuns = []
  for (const m of s.matchAll(/[\u4e00-\u9fff]+/g)) hanRuns.push({ start: m.index, text: m[0] })
  const hanPinyin = new Map()
  for (const run of hanRuns) {
    let arr = []
    try { arr = pinyin(run.text, { toneType: 'num', type: 'array' }) } catch { arr = [] }
    for (let i = 0; i < run.text.length; i++) hanPinyin.set(run.start + i, arr[i] || '')
  }

  const units = []
  let t = 0
  const push = (ch, viseme, ms) => {
    const d = Math.max(40, Math.round(ms))
    units.push({ ch, viseme, ms: d, start: t })
    t += d
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]

    if (isPunct(ch)) { t += Math.round(R.punct[ch] * rate); continue }
    if (ch === ' ') { t += Math.round(R.punct[' '] * rate); continue }

    if (isHan(ch)) {
      const raw = hanPinyin.get(i) || ''
      const tone = Number((raw.match(/\d\s*$/) || [])[0]) || 0
      const syl = raw.replace(/\d/g, '')
      const sylMs = R.zh.syllable * rate * (R.zh.tone[tone] ?? 1)
      const onset = ZH_ONSET[(syl.match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcs])/) || [])[1] || ''] || null
      const onsetMs = onset ? Math.min(R.zh.onset * rate, sylMs * 0.4) : 0
      if (onset) push(ch, onset, onsetMs)
      push(ch, zhVowel(syl), sylMs - onsetMs)
      continue
    }

    if (isKana(ch)) {
      if (ch === 'ー') {                    // 长音：把上一拍拖长
        const prev = units[units.length - 1]
        if (prev) { const extra = Math.round(prev.ms * (R.ja.choon - 1)); prev.ms += extra; t += extra }
        continue
      }
      if (ch === 'っ') { push(ch, 'm', R.ja.sokuon * rate); continue }
      if (SMALL_KANA[ch]) {                 // 拗音：跟前一拍合成
        const prev = units[units.length - 1]
        const d = Math.round(R.ja.syllable * R.ja.small * rate)
        if (prev) { prev.viseme = SMALL_KANA[ch]; prev.ms += d; t += d }
        else push(ch, SMALL_KANA[ch], d)
        continue
      }
      const big = /[\u30a1-\u30f6]/.test(ch) ? String.fromCharCode(ch.charCodeAt(0) - 0x60) : ch
      push(ch, KANA_ROW[ch] || KANA_ROW[big] || 'e', R.ja.syllable * rate)
      continue
    }

    if (isLatin(ch)) {
      const low = ch.toLowerCase()
      const v = EN_LETTER[low] || 'e'
      const base = EN_VOWELS.has(low) ? R.en.vowel : R.en.consonant
      push(ch, v, base * rate)
      continue
    }

    if (isDigit(ch)) { push(ch, DIGIT_VISEME[ch] || 'i', R.digit.syllable * rate); continue }

    // 其它字符（表情符号等）当作一个短停顿
    t += Math.round(R.other.unit * rate)
  }

  const merged = coalesce(units)
  return { units: merged, totalMs: t, rate }
}

/** 这句话该念多久（毫秒）——气泡停留 / 字幕保持都用它 */
export function speechMs(text, opts = {}) {
  return planSpeech(text, opts).totalMs
}

/**
 * 取某个时刻的口型：**返回插值后的连续数值**（不是离散口型名）。
 * 相邻元音之间做 55% 的渐变，所以嘴是「滑过去」而不是一格一格跳；
 * 音节首尾各留一小段包络，听起来才有起音/收音。
 */
export function sampleAt(plan, ms, opts = {}) {
  const units = plan?.units || []
  if (!units.length) return null
  let i = units.length - 1
  for (let k = 0; k < units.length; k++) {
    if (ms < units[k].start + units[k].ms) { i = k; break }
  }
  const u = units[i]
  const p = units[i - 1]
  const k = clamp((ms - u.start) / Math.max(1, u.ms), 0, 1)

  // 口型过渡：本单元前 55% 从上一个口型滑过来
  const blendK = p ? clamp(k / 0.55, 0, 1) : 1
  const a = VISEMES[p?.viseme] || VISEMES[u.viseme]
  const b = VISEMES[u.viseme] || VISEMES.e
  const open = a.open + (b.open - a.open) * blendK
  const form = a.form + (b.form - a.form) * blendK
  const round = (a.round || 0) + ((b.round || 0) - (a.round || 0)) * blendK

  // 包络：起音 16% 张开，尾段收到 0.6（不完全闭合，下个音节才接得上）
  const attack = clamp(k / 0.16, 0, 1)
  const tail = 1 - 0.4 * clamp((k - 0.78) / 0.22, 0, 1)
  const env = attack * tail
  return { viseme: u.viseme, prev: p?.viseme || null, env, open, form, round }
}
