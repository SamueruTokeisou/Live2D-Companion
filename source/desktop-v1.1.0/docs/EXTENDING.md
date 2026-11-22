# 扩展接口（不改源码换掉口型与动作）

目标是：**别人想用自己的 TTS、自己的动作，不用 fork 这个仓库。**
两个正式接口，一个入口对象 `window.Live2DStage`。

```js
// 浏览器控制台 / 扩展文件里都能直接用
window.Live2DStage.registerLipSync({ id, name, create(ctx) { ... } })
window.Live2DStage.useLipSync('my-tts')
window.Live2DStage.clearLipSync()

window.Live2DStage.registerActionPack({ id, name, actions: [ ... ] })
window.Live2DStage.unregisterActionPack('my-pack')
window.Live2DStage.listActionPacks()

window.Live2DStage.registerVariants({ 头: { pet: [ ... ] } })   // 互动差分（接口三）
window.Live2DStage.listVariants()
```

## 怎么加载你的扩展文件

把文件放进仓库的 `extensions/` 目录（静态服务会直接托管），启动时加参数：

```
大肥鱼Live2d桌宠.exe --ext="/extensions/my-ext.js"
大肥鱼Live2d桌宠.exe --ext="/extensions/a.js,/extensions/b.js"
```

或者用环境变量（开发版、打包版都认）：

```bash
STAGE_EXT="/extensions/a.js,/extensions/b.js" npm run app
```

> 也可以直接在控制台手动加载：`import('/extensions/my-ext.js')`。

扩展文件里直接写：

```js
const api = window.Live2DStage
api.registerLipSync({ /* ... */ })
```

**加载失败不会拖垮舞台**：只会在控制台告警 + 气泡提示，内置行为照常。

---

## 接口一：口型驱动（TTS / 音频 / 自己的唇形算法）

### 注册

```js
window.Live2DStage.registerLipSync({
  id: 'my-tts',
  name: '我的 TTS',
  create(ctx) {
    // ctx: { mouth, stage, log }
    let playing = false
    return {
      /** 可选：能接文本就交给它，返回这段的毫秒时长（气泡停留用它） */
      speakText(text, { rate } = {}) {
        playing = true
        return 1200 + text.length * 90
      },
      /**
       * 每帧调用（必须实现其一，或两个都实现）：
       *   返回 number 0..1  → 能量，按 talkOpen 缩放成张嘴幅度
       *   返回 { open, form, funnel, pucker, jaw } → 直接给口型形状（绝对值，additive 叠加）
       *   返回 null        → 这一帧交还内置口型（呼吸 + 音节）
       */
      frame(dtMs) {
        if (!playing) return null
        return analyserRms()          // 真实 TTS：读 AnalyserNode 的 RMS
      },
      /** 可选：停止 / 打断 */
      stop() { playing = false },
    }
  },
})
```

接现成 TTS 的典型写法（用 `<audio>` + `AnalyserNode`）：

```js
const audio = new Audio()
const ac = new AudioContext()
const src = ac.createMediaElementSource(audio)
const an = ac.createAnalyser()
an.fftSize = 512
src.connect(an); an.connect(ac.destination)
const buf = new Uint8Array(an.fftSize)

window.Live2DStage.registerLipSync({
  id: 'audio-rms',
  create() {
    return {
      async speakText(text) {
        const url = await myTts(text)       // 你的 TTS：返回音频 URL
        audio.src = url; await audio.play()
        return audio.duration * 1000
      },
      frame() {
        if (audio.paused) return null
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x }
        return Math.min(1, Math.sqrt(sum / buf.length) * 3)   // RMS → 0..1
      },
      stop() { audio.pause() },
    }
  },
})
```

### 生效与让位

- `useLipSync(id)` 之后，**内置文本口型（拼音音节）会让位**；provider 返回 `null` 时内置立刻接管。
- 呼吸层与情绪嘴型始终保留（provider 只接管开合/形状）。
- 卸载：`clearLipSync()` 回到内置口型。

### 注意

- 口型是**加性写入**的：`open` 给的是增量，不要每帧写满 1。
- `frame()` 里别做重活（每帧都调）；要解码音频就提前做，或用 AnalyserNode 这种零分配读法。
- provider 抛异常会被捕获并回退内置（不会把渲染循环打断），但错误每帧都会打日志，别长期带病运行。

---

## 接口二：动作包（自定义动作链 / 替换内置动作）

### 数据格式

和编辑台导出的动作完全一致：

```js
{
  id: 'demo:nod',            // 可省，默认 `${包id}:${name}`
  name: '点头问好',
  duration: 1200,            // 毫秒；省了按最后一个关键帧 +120
  params: ['ParamAngleY'],   // 可省，从 keys 里推断
  keys: [                    // 关键帧（**绝对值**，不是增量）
    { t: 0,    values: { ParamAngleY: 0 } },
    { t: 220,  values: { ParamAngleY: -14 } },
    { t: 1200, values: { ParamAngleY: 0 } },
  ],
  lines: ['你好呀'],          // 可选：动作开始时的气泡台词
  holds: {},                 // 可选：物理输出参数的归一化曲线 [[t,v],...]（没把握别写）
  base: null,                // 可选：动作基底参数
}
```

### 注册与替换

```js
window.Live2DStage.registerActionPack({
  id: 'my-pack',
  name: '我的动作包',
  actions: [ /* 上面那种条目 */ ],
})
```

- **不同名**：追加到编辑台左栏末尾。
- **同名**（比如 `name: '东张西望'`）：**替换**内置那条，动作链换成你的。
- 编辑台左栏与舞台的按名播放（`idlePlay`）都走同一份清单，注册完立刻可见。
- 想拿一份现成的骨架：在编辑台随便改个动作 → 复制 JSON → 粘进你的包里。

### 参数名去哪查

- 模型参数：编辑台左栏的参数列表，或 `model3.json` 的 `Parameters`。
- 常用：`ParamAngleX/Y/Z`（头）、`ParamBodyAngleX/Y/Z`（身）、`ParamEyeBallX/Y`（眼）、
  `ParamMouthOpenY`（嘴）、`Param56/Param57`（手状态，见 `poses.js` 的约定）。
- 物理输出参数（`LEGAngleZ2`、`Param44`、`LeanInput` 这类）**不能进 keyframes**，
  只能在 `holds` 里给归一化曲线 —— 直接写数值会让物理链坏掉（头/头发画没）。

---

## 接口三：互动情绪差分（换掉 / 追加某个互动触发的反应）

每个「部位 × 手势」默认有 3~4 套差分（`src/stage/variants.js`），触发时按**当前情绪**加权抽签。
情绪标签沿用 `semantics.js` 的 12 套配方（傲娇 / 害羞 / 生气 / 撒娇 / 惊讶 / 得意 / 委屈 / 嫌弃 / 好奇 / 困倦 / 慌乱 / 心动），
外加一个 `开心`（待机挥手那类单纯高兴，没有整段配方）。**某个情绪越高，标了它的差分越容易被抽中**，
所以刚被摸过胯，下一次摸胯更容易是「黑脸威胁」而不是「脸红慌乱」。

### 一条差分长什么样

```js
{
  id: 'head-pet-bite',        // 必需且唯一：抽签靠它排除「上一次同一个」
  line: '再摸我要咬人了哦。',   // 台词（气泡直说，不经过 phrases.js）
  mood: { 生气: 1.2, 傲娇: 0.8 },   // 情绪权重：当前值 × boost，越大越容易抽中
  expr: ['＞＜', '黑脸'],       // 可选：表情组（覆盖该部位默认反应）
  mouth: { form: -0.25, ms: 2200 }, // 可选：嘴形偏移（open/form/smile/funnel/pucker/jaw）
  act: '嫌弃',                // 可选：顺带播的动作名或情绪配方名
  params: [{ Id: 'ParamEyeLOpen', Value: 0.5, Blend: 'Overwrite' }], // 可选：自定义参数
  weight: 1,                  // 可选：基础权重（默认 1）
}
```

### 注册 / 覆盖

```js
window.Live2DStage.registerVariants({
  头: {
    pet: [
      { id: 'my-head-sleepy', line: '让我再睡一下…', mood: { 困倦: 1.5 } }, // 新 id = 追加
      { id: 'head-pet-happy', line: '好啦好啦，再摸一下下。' },              // 同 id = 覆盖字段
    ],
  },
})
window.Live2DStage.listVariants()   // 看现有全部差分（返回副本，改它不影响抽签）
```

- **同 id 覆盖**只替换你写过的字段，没写的（表情 / 嘴形 / 情绪权重）保留内置值。
- 手势只有 `tap`（点）/ `pet`（摸第一步）/ `down`（按下，捏脸用）/ `dragEnd`（长裙提裙）。
- 热区名以 `live2d_catalog` / 编辑台为准：头 / 额头 / 左脸 / 右脸 / 胸 / 腰 / 裙摆 / 腿 / 脚 / 左手 / 右手 / 胯 / 尾巴 / 长裙。
- 抽签**不会连着两次同一个 id**（只剩一个候选时才会重复）。
- 调分布时用探针：`__probe.variantWeights('胯','pet')` 看当前情绪下的权重、`__probe.variantPick('头','pet')` 手动抽一条。
- 开关型互动（脱鞋 / 换裙 / 尾巴开关 / 胸口衣服）**开关语义不会被差分改掉**，差分只换「切的时候说什么、什么表情」。

---

## 版本与兼容

- `window.Live2DStage.apiVersion` 目前是 `1`；接口只做加法，破坏性改动会升版本号。
- 扩展文件若在舞台就绪前加载：`registerLipSync` 可以先注册，`useLipSync` 会等嘴建好再调用
  （过早调用会抛 `舞台还没就绪`，在 `window.Live2DStage` 出现后再执行即可）。

## 参考实现

- `extensions/example-lipsync.js` —— 音频能量驱动口型（含暂停/换气）
- `extensions/example-actions.js` —— 自定义关键帧动作 + 同名替换内置
- `extensions/example-variants.js` —— 追加 / 覆盖互动差分（换台词与情绪反应）
