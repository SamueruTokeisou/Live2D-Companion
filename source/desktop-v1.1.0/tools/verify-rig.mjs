// 骨架 / 成套动作回归验证（无头）。
//
// 用法：
//   node scripts/serve.mjs --port 53180 --model "<…>.model3.json"   # 另开一个终端
//   node tools/verify-rig.mjs --url http://127.0.0.1:53180
//
// 覆盖：动作清单 / 手位偏移是否真的写进举手链 / 链式动作推进 / 防御抚胸链路 / 动作结束是否归零。
import puppeteer from 'puppeteer-core'
import { access } from 'node:fs/promises'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const BASE = arg('url', 'http://127.0.0.1:53180')
const PAGE = `${BASE}/tmp/pose-lab.html?manual=1`

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
async function findBrowser() {
  for (const p of BROWSERS) { try { await access(p); return p } catch {} }
  throw new Error('找不到 Edge/Chrome')
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const main = async () => {
  const browser = await puppeteer.launch({
    executablePath: await findBrowser(), headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 900, height: 1200, deviceScaleFactor: 1 },
  })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForFunction('window.__ready === true || window.__error', { timeout: 60000, polling: 200 })
    await wait(600)
    if (await page.evaluate(() => !!window.__error)) throw new Error(await page.evaluate(() => window.__error))

    // ① 动作清单里有新手位动作
    const list = await page.evaluate(async () => (await window.__stageRpc('act', {})).routines)
    const need = ['捂嘴偷笑', '托腮', '半平举', '高举', '挥手打招呼', '杂鱼晃手', '扭腰', '扭扭腿', '护胸防御']
    check('动作清单含新动作', need.every((n) => list.includes(n)), `共 ${list.length} 个`)

    // ② 捂嘴：手位偏移要真的落到举手链上（62 ≈ -1，59 ≈ +1，60 ≈ 0）
    await page.evaluate(async () => { await window.__stageRpc('act', { name: '捂嘴偷笑' }) })
    // 等「真的到位」而不是等墙钟：无头渲染掉帧时，动画进度会落后于真实时间
    await page.waitForFunction(() => {
      const t = window.__probe.tuneState()
      return Math.abs(t.Param62 + 1) < 0.12 && Math.abs(t.Param59 - 1) < 0.12
    }, { timeout: 8000, polling: 50 })
    const t1 = await page.evaluate(() => window.__probe.tuneState())
    check('捂嘴手位写入举手链', Math.abs(t1.Param62 + 1) < 0.12 && Math.abs(t1.Param59 - 1) < 0.12 && Math.abs(t1.Param60) < 0.12,
      `62=${t1.Param62.toFixed(2)} 59=${t1.Param59.toFixed(2)} 60=${t1.Param60.toFixed(2)}`)

    // ③ 动作结束后归零（否则会留残姿）
    await page.waitForFunction(() => {
      const t = window.__probe.tuneState()
      return Math.abs(t.Param62) < 0.05 && Math.abs(t.Param59) < 0.05
    }, { timeout: 9000, polling: 60 })
    const t2 = await page.evaluate(() => window.__probe.tuneState())
    check('动作结束手位归零', Math.abs(t2.Param62) < 0.05 && Math.abs(t2.Param59) < 0.05, `62=${t2.Param62.toFixed(2)} 59=${t2.Param59.toFixed(2)}`)

    // ④ 链式动作：甲>乙 依次播
    const seqStart = await page.evaluate(async () => (await window.__stageRpc('act', { name: '扭腰>捂嘴偷笑' })).played)
    const s1 = await page.evaluate(() => window.__probe.idleState())
    await page.waitForFunction(() => window.__probe.idleState()?.current === '捂嘴偷笑', { timeout: 9000, polling: 60 })
    const s2 = await page.evaluate(() => window.__probe.idleState())
    check('链式动作推进', seqStart === '扭腰' && s1.current === '扭腰' && s2.current === '捂嘴偷笑',
      `起=${seqStart} · 后=${s2.current} · 队列=${JSON.stringify(s1.queue)}`)

    // ④b 命名组合：傲娇三拍 = 别过头 > 偷瞄 > 撩头发
    const combo = await page.evaluate(async () => (await window.__stageRpc('act', { name: '傲娇三拍' })).played)
    const c1 = await page.evaluate(() => window.__probe.idleState())
    check('命名组合展开成链', combo === '别过头' && c1.queue?.join('>') === '偷瞄>撩头发',
      `起=${combo} · 队列=${JSON.stringify(c1.queue)}`)
    const combosList = await page.evaluate(async () => (await window.__stageRpc('act', {})).combos)
    check('组合清单可读', Array.isArray(combosList) && combosList.length >= 6, JSON.stringify(combosList))

    // ④c 连写「看」按顺序排队（来回转头）
    const looks = await page.evaluate(async () => window.__stageRpc('intent', { text: '【看|左】【看|右】' }))
    check('连写看排队', looks.results?.length === 2 && looks.results.every((r) => r.ok) && /@/.test(String(looks.results[1].detail)),
      JSON.stringify(looks.results))

    // ④d 口型时间轴：文本 → 时长
    const talk = await page.evaluate(async () => {
      window.__stageRpc('intent', { text: '你好呀，今天天气不错！' })
      return null
    })
    await wait(200)
    const mouth = await page.evaluate(() => window.__probe.mouth())
    check('口型时间轴生效', mouth.speaking === true && mouth.speechMs > 800, JSON.stringify({ speaking: mouth.speaking, ms: mouth.speechMs }))

    // ④e 语速表：慢档一定比正常长，正常语速下中文不会快到「一秒六个字」
    const durs = await page.evaluate(() => ({
      zh: window.__probe.speechMs('你好呀，今天天气不错！'),
      zhSlow: window.__probe.speechMs('你好呀，今天天气不错！', { rate: 'slow' }),
      zhFast: window.__probe.speechMs('你好呀，今天天气不错！', { rate: 'fast' }),
      ja: window.__probe.speechMs('こんにちは、元気？'),
      en: window.__probe.speechMs('hello world'),
    }))
    check('语速表决定时长', durs.zhSlow > durs.zh && durs.zh > durs.zhFast && durs.zh > 1800,
      JSON.stringify(durs))

    // ④f 让位窗口内也照常推进（先说话会把待机 pause 掉，再点名动作不能只进池子不播）
    await page.evaluate(async () => { await window.__stageRpc('intent', { text: '先说一句，再动。' }) })
    await page.evaluate(async () => { await window.__stageRpc('act', { name: '扭腰' }) })
    await page.waitForFunction(() => window.__probe.idleState()?.current === '扭腰' && (window.__probe.idleState()?.progress || 0) > 0.05, { timeout: 8000, polling: 40 })
    const w1 = await page.evaluate(() => window.__probe.idleState())
    check('让位窗口内动作照常推进', w1.current === '扭腰' && w1.progress > 0.05,
      JSON.stringify({ cur: w1.current, p: w1.progress }))

    // ④g 关掉待机随机动作后，手动动作仍然要播（「写了不播」的真凶：设置里 idle:false）
    await page.evaluate(() => window.__probe.idleEnabled(false))
    await page.evaluate(async () => { await window.__stageRpc('act', { name: '扭腰' }) })
    await page.waitForFunction(() => window.__probe.idleState()?.current === '扭腰' && (window.__probe.idleState()?.progress || 0) > 0.05, { timeout: 8000, polling: 40 })
    const offIdle = await page.evaluate(() => window.__probe.idleState())
    await page.evaluate(() => window.__probe.idleEnabled(true))
    check('待机关闭时手动动作照播', offIdle.current === '扭腰' && offIdle.progress > 0.05,
      JSON.stringify({ cur: offIdle.current, p: offIdle.progress }))

    // ④h 带手臂的动作会自己切到举手族（默认手下手链参数是空转的）
    await page.evaluate(() => { window.__probe.pose('默认手', 0); window.__probe.tuneClear(0) })
    await page.evaluate(async () => { await window.__stageRpc('act', { name: '托腮' }) })
    await page.waitForFunction(() => Math.abs(window.__probe.tuneState().Param59) > 0.2, { timeout: 8000, polling: 50 })
    const armFam = await page.evaluate(() => ({ active: window.__probe.poseState().active, tune: window.__probe.tuneState() }))
    check('带手臂动作自动切举手族', /举手|抚胸/.test(String(armFam.active)) && Math.abs(armFam.tune.Param59) > 0.2,
      `族=${armFam.active} 59=${(armFam.tune.Param59 || 0).toFixed(2)}`)

    // ④i 腿没有独立骨：扭扭腿必须靠胯带动腿，身体也要跟着
    await page.evaluate(async () => { await window.__stageRpc('act', { name: '扭扭腿' }) })
    await page.waitForFunction(() => window.__probe.idleState()?.current === '扭扭腿' && (window.__probe.idleState()?.progress || 0) > 0.15, { timeout: 8000, polling: 40 })
    const legs = await page.evaluate(async () => {
      // 物理输出参数只能靠 hold 写；探针读参数会读到物理重算前的值，所以直接看 hold 表
      const held = Object.fromEntries(window.__probe.held())
      return { leg: held.LEGAngleZ2, body: await window.__probe.readAtUpdate('ParamBodyAngleZ') }
    })
    check('扭腿由胯带动、身体跟随', Math.abs(legs.leg || 0) > 1.5 && Math.abs(legs.body) > 0.2,
      JSON.stringify({ leg: +(legs.leg || 0).toFixed(2), body: +(legs.body || 0).toFixed(2) }))
    // ④i 忘记放手：到点自动收回默认手
    await page.evaluate(() => window.__probe.pose('竖手指', 0))
    await page.evaluate(() => window.__probe.poseHold(500))
    // 等真的回到默认手（固定等待在慢帧下会偶发失败）
    await page.waitForFunction(() => window.__probe.poseState().active === '默认手', { timeout: 8000, polling: 60 }).catch(() => {})
    const rel = await page.evaluate(() => ({ active: window.__probe.poseState().active, hands: window.__probe.poseState().hands }))
    check('姿势超时自动收回', rel.active === '默认手' && !rel.hands?.left, JSON.stringify(rel))

    // ④j 中键拖动也走物理：拖起来要有抓取向量、身体参数被甩（以前是纯位移，一点物理都没有）
    await page.evaluate(() => {
      const el = document.getElementById('stage')
      const r = el.getBoundingClientRect()
      const x = Math.round(r.left + r.width / 2)
      const y = Math.round(r.top + r.height / 2)
      const mk = (type, extra = {}) => new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 21, button: 1,
        buttons: type === 'pointerup' ? 0 : 4,
        clientX: x, clientY: y, screenX: 400, screenY: 300, ...extra,
      })
      el.dispatchEvent(mk('pointerdown'))
      for (let i = 1; i <= 6; i++) {
        el.dispatchEvent(mk('pointermove', { clientX: x + i * 10, screenX: 400 + i * 22 }))
      }
    })
    await wait(120)
    const midDrag = await page.evaluate(async () => ({
      dragging: window.__pass.dragState().dragging,
      vx: window.__pass.dragState().vec?.vx || 0,
      rx: await window.__probe.readAtUpdate('ParamBodyAngleRX'),
    }))
    await page.evaluate(() => {
      const el = document.getElementById('stage')
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 21, button: 1, buttons: 0 }))
    })
    check('中键拖动带物理（抓取向量 + 身体被甩）',
      midDrag.dragging === true && Math.abs(midDrag.vx) > 100 && Math.abs(midDrag.rx || 0) > 0.2,
      JSON.stringify({ dragging: midDrag.dragging, vx: Math.round(midDrag.vx), rx: +(midDrag.rx || 0).toFixed(2) }))

    // ④k 语义配方：傲娇 = 歪头 + 半闭眼 + 耳朵转动 + 脸红
    await page.evaluate(async () => { await window.__stageRpc('intent', { text: '【情绪|傲娇】' }) })
    // 耳朵转动是「扑棱包络」里的瞬时值，单点采样会恰好落在衰减尾巴上 → 取一段时间内的峰值
    let maxFlip = 0
    for (let i = 0; i < 8; i++) {
      await wait(90)
      const f = await page.evaluate(async () => Math.abs(await window.__probe.readAtUpdate('LFlip')))
      if ((f || 0) > maxFlip) maxFlip = f || 0
    }
    const emo = await page.evaluate(async () => ({
      cur: window.__probe.idleState().current,
      z: await window.__probe.readAtUpdate('ParamAngleZ'),
      eye: await window.__probe.readAtUpdate('ParamEyeLOpen'),
      blush: (window.__pass.exprs().layers || []).some((l) => l.name === '脸红'),
    }))
    check('情绪配方生效（歪头+半闭眼+耳转+脸红）',
      emo.cur === '傲娇' && Math.abs(emo.z) > 2 && emo.eye < 0.95 && maxFlip > 0.02 && emo.blush,
      JSON.stringify({ cur: emo.cur, z: +(emo.z || 0).toFixed(1), eye: +(emo.eye || 0).toFixed(2), flipMax: +maxFlip.toFixed(3), blush: emo.blush }))

    // ④l 张口带下巴：只拉嘴不开下巴，看着像嘴被撕开
    await page.evaluate(async () => { await window.__stageRpc('intent', { text: '啊——' }) })
    await wait(220)
    const jaw = await page.evaluate(async () => await window.__probe.readAtUpdate('JawOpen'))
    check('张口时下巴跟着开', (jaw || 0) > 0.05, `JawOpen=${(jaw || 0).toFixed(2)}`)

    // ④m 动作速度：0.5 时剩余时长翻倍；超过 1 会被夹回上限（预设速度）
    const spd = await page.evaluate(async () => {
      window.__probe.setPlayback(1)
      await window.__stageRpc('act', { name: '扭腰' })
      await new Promise((r) => setTimeout(r, 120))
      const fast = window.__probe.idleRemaining()
      window.__probe.setPlayback(0.5)
      const slow = window.__probe.idleRemaining()
      const over = window.__probe.setPlayback(3)
      window.__probe.setPlayback(1)
      return { fast, slow, over }
    })
    check('动作速度可调且上限为预设速度',
      spd.slow > spd.fast * 1.6 && spd.over === 1,
      JSON.stringify({ fast: spd.fast, slow: spd.slow, capped: spd.over }))

    // ⑤a 表情有期限：没写 ms 的「脸红」跟着这一轮的 T 一起退（以前会挂一整天）
    // 先等上一段动作播完，否则表情会跟着那个动作的剩余时长走（这是设计，不是 bug）
    await page.waitForFunction(() => window.__probe.idleState()?.current == null, { timeout: 9000, polling: 80 })
    await page.evaluate(async () => { await window.__stageRpc('intent', { text: '【表情|脸红】' }) })
    await wait(220)
    const faceOn = await page.evaluate(() => (window.__pass.exprs().layers || []).some((l) => l.name === '脸红'))
    await wait(1100)
    const faceOff = await page.evaluate(() => (window.__pass.exprs().layers || []).some((l) => l.name === '脸红'))
    check('表情到点自动退出', faceOn === true && faceOff === false, JSON.stringify({ on: faceOn, off: faceOff }))

    // ⑤b 字幕时长 = max(T1 说话, T2 动作)：动作比话长时必须陪到动作演完
    const holds = await page.evaluate(async () => ({
      short: window.__probe.bubbleHold('嗯'),
      long: window.__probe.bubbleHold('这是一句非常非常长的话，长到足够让口型时间轴明显超过一秒以上，看看字幕会不会挂太久。'),
      action: window.__probe.bubbleHold('嗯', 2800),
    }))
    check('字幕时长取说话与动作的较大者', holds.action === 2800 && holds.long > holds.short && holds.short >= 900,
      JSON.stringify(holds))

    // ⑤c 动作比话长：气泡要一直挂到动作结束（傲娇 2.8s vs 「嗯」~0.9s）
    await page.evaluate(async () => { await window.__stageRpc('intent', { text: '【情绪|傲娇】嗯。' }) })
    await wait(1600)
    const midBubble = await page.evaluate(() => window.__probe.bubbleState()?.visible)
    await wait(1800)
    const endBubble = await page.evaluate(() => window.__probe.bubbleState()?.visible)
    const settled = await page.evaluate(() => ({
      idle: window.__probe.idleState().current,
      blush: (window.__pass.exprs().layers || []).some((l) => l.name === '脸红'),
      mood: window.__probe.mouth()?.mood,
    }))
    check('动作比话长时气泡陪到动作结束', midBubble === true && endBubble === false,
      JSON.stringify({ mid: midBubble, end: endBubble }))
    check('播放完毕状态回归默认', settled.idle == null && settled.blush === false && settled.mood === false,
      JSON.stringify(settled))

    // ⑤ 防御抚胸：先回到默认手（举手族会自动把右手标成抚胸，直接 toggle 会把它关掉）
    await wait(300)
    await page.evaluate(() => { window.__probe.pose('默认手', 0); window.__probe.tuneClear(0) })
    await wait(500)
    const on = await page.evaluate(() => window.__stageRpc('hand', { side: 'right' }))
    check('抚胸可以打开', on.hands?.right === '抚胸', JSON.stringify(on.hands))
    await wait(800)
    const m = await page.evaluate(() => window.__stageRpc('measure'))
    const b = m.handsScreen?.左手
    if (b) {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++) { await page.mouse.move(cx + i * 5, cy + i * 2); await wait(40) }
      await page.mouse.up()
    }
    await wait(900)
    const d = await page.evaluate(() => ({
      idle: window.__probe.idleState().current,
      bubble: window.__probe.bubbleState().text,
      hands: window.__probe.poseState()?.hands,
    }))
    check('护胸后继续摸 → 防御动作', d.idle === '护胸防御', `当前=${d.idle}`)
    check('防御台词进气泡', /恬|不许|生气/.test(d.bubble || ''), d.bubble)
    check('防御期间手仍在护胸', d.hands?.right === '抚胸', JSON.stringify(d.hands))

    check('页面无异常', errors.length === 0, errors.join(' | ').slice(0, 120))
  } finally {
    await browser.close()
  }
  const bad = results.filter((r) => !r.ok)
  console.log(`\n${bad.length ? 'FAILED' : 'ALL PASS'}  (${results.length - bad.length}/${results.length})`)
  process.exitCode = bad.length ? 1 : 0
}
main().catch((e) => { console.error(e); process.exit(1) })
