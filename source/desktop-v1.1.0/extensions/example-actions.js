/**
 * 示例扩展 ②：自定义动作包（关键帧动作 + 覆盖内置动作）。
 *
 * 用法：启动时加 `?ext=/extensions/example-actions.js`，
 * 然后在编辑台左栏就能看到「示例：点头问好」，舞台里也能按名字播：
 *   window.__probe.idlePlay('示例：点头问好')
 *
 * 数据格式（和编辑台导出的一致）：
 *   { id, name, duration, params:[参数名], keys:[{ t:毫秒, values:{ 参数名: 值 } }], holds?:{} }
 *   · keys 里的 values 是**绝对值**，不是增量；
 *   · holds 存的是归一化曲线 [[t,v],...]（物理输出参数用），没把握就别写。
 *
 * 「替换内置动作」：把 name 写成和内置同名（例如「东张西望」），注册后就会盖掉内置那条；
 * 内置名字清单：window.Live2DStage.listActionPacks() / 编辑台左栏。
 */
const api = (window.Live2DStage ||= {})

api.registerActionPack({
  id: 'demo-actions',
  name: '示例动作包',
  actions: [
    {
      id: 'demo:nod',
      name: '示例：点头问好',
      duration: 1200,
      params: ['ParamAngleY', 'ParamAngleX', 'ParamBodyAngleY', 'Param56'],
      keys: [
        { t: 0, values: { ParamAngleY: 0, ParamAngleX: 0, ParamBodyAngleY: 0, Param56: 1 } },
        { t: 220, values: { ParamAngleY: -14, ParamAngleX: 3, ParamBodyAngleY: -4, Param56: 1 } },
        { t: 520, values: { ParamAngleY: 8, ParamAngleX: 0, ParamBodyAngleY: 2, Param56: 1 } },
        { t: 820, values: { ParamAngleY: -6, ParamAngleX: -2, ParamBodyAngleY: -2, Param56: 1 } },
        { t: 1200, values: { ParamAngleY: 0, ParamAngleX: 0, ParamBodyAngleY: 0, Param56: 1 } },
      ],
      lines: ['你好呀'],
    },
  ],
})
