/**
 * 示例扩展 ③：互动情绪差分（追加 / 覆盖某个互动的反应）。
 *
 * 用法：启动时加 `?ext=/extensions/example-variants.js`，然后摸头试试。
 * 两条示例演示两种写法：
 *   · 新 id  = 追加（和内置四套一起抽签）
 *   · 同 id  = 覆盖字段（只改台词，表情/嘴形/情绪权重保留内置）
 *
 * 字段说明见 docs/EXTENDING.md「接口三」。
 * 情绪标签沿用 semantics.js 的 12 套 + 开心；当前情绪越高，标了它的差分越容易被抽中。
 */
const api = (window.Live2DStage ||= {})

api.registerVariants({
  头: {
    pet: [
      // 新 id：追加一条「摸烦了」的差分，生气/傲娇高的时候更容易抽到
      {
        id: 'demo-head-pet-bite',
        line: '再摸我要咬人了哦。',
        mood: { 生气: 1.2, 傲娇: 0.8 },
        mouth: { form: -0.25, ms: 2200 },
      },
      // 同 id：只把内置的「再摸就咬你哦」换成这句，其余字段（情绪权重/嘴形）照旧
      { id: 'head-pet-happy', line: '好啦好啦，再摸一下就一下下。' },
    ],
  },
  脚: {
    // tap 是脱鞋开关：差分只换说话内容，开关行为不变
    tap: [
      {
        id: 'demo-foot-tap-tickle',
        line: '等、等一下，先别脱——',
        mood: { 慌乱: 1.4, 害羞: 0.6 },
        mouth: { jaw: 0.2, funnel: 0.2, ms: 2400 },
      },
    ],
  },
})
