/**
 * 示例扩展 ①：用「音频能量」驱动口型。
 *
 * 用法：启动时加 `?ext=/extensions/example-lipsync.js`，然后：
 *   window.Live2DStage.useLipSync('demo-energy')
 *   window.Live2DStage.mouth.speakText('你好呀')   // 内置文本口型会被 provider 顶掉
 *
 * 真实 TTS 集成里，把 `energy` 换成 AnalyserNode.getByteTimeDomainData 算出的 RMS 即可。
 * 注意：provider.frame() 返回 null 时，内置口型（呼吸/音节/文本）会立刻接管回来。
 */
const api = (window.Live2DStage ||= {})

api.registerLipSync({
  id: 'demo-energy',
  name: '示例：音频能量',
  create(ctx) {
    let talking = false
    let until = 0
    let phase = 0

    return {
      // 开始一段话：返回时长（毫秒），气泡停留就用它
      speakText(text, opts = {}) {
        const ms = Math.max(400, text.length * 120)
        talking = true
        until = performance.now() + ms
        phase = 0
        ctx.log?.('demo-energy 开始说：', text)
        return ms
      },
      // 每帧给能量 0..1（这里用正弦模拟，真接 TTS 时换成真实 RMS）
      frame(dtMs) {
        if (!talking) return null
        if (performance.now() > until) { talking = false; return null }
        phase += dtMs / 1000
        const syll = Math.abs(Math.sin(phase * 12)) * 0.6 + Math.abs(Math.sin(phase * 27)) * 0.25
        const pause = Math.sin(phase * 2.1) > 0.88
        return pause ? 0.02 : Math.min(1, 0.15 + syll)
      },
      stop() { talking = false },
    }
  },
})
