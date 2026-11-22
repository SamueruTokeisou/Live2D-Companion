# 外部项目参考与产品取舍

调研日期：2026-11-22。只核对公开说明、许可和部分源码，未安装运行对方软件。“完整程度”指已公开的功能覆盖和产品流程，不等于本项目已经独立验证其稳定性。

## 当前决策

项目所有者关注单角色体验与未来自己的 Live2D 模型。多角色同台没有当前需求，不进入近期路线。本次只做记录，不修改应用代码、运行配置或安装软件。

## 棉花糖 Marshmallow

来源：[v1.0.0 发布说明](https://github.com/HoppoChan0721/dsh-desktop-petbox/releases/tag/v1.0.0)、[仓库](https://github.com/HoppoChan0721/dsh-desktop-petbox)。

保留三项候选：音频/字幕/口型共用时钟；穿戴体型与临时表情分层；一个角色的待机节奏和动作幅度可调。声音实现可参考其 [voice.js](https://github.com/HoppoChan0721/dsh-desktop-petbox/blob/v1.0.0/stage/voice.js) 中的音量包络驱动设计。

多实例同台虽然是对方已有玩法，但不因其存在就加入我们的任务。任何代码复用前仍核对具体文件和第三方组件声明。

## Coopanion

来源：[仓库与产品说明](https://github.com/Pal-AI-Lab/Coopanion)、[桌宠扩展协议](https://github.com/Pal-AI-Lab/Coopanion/blob/main/packages/cortico-world-desktop-pet/README.md)。本次查到主项目版本为 0.2.23；版本数字不能直接与其他项目比较成熟度。

它以 Cortico 为基础，把桌宠、对话、语音输入、记忆、提醒和可选电脑操作组合成伙伴应用，并提供形象包与 Worlds 扩展。我们的当前基线是显示和管理 Cubism 模型、互动与后续适配，尚未实现上述 AI 伙伴链路。

最值得参考的设计：

- 首次使用引导将称呼、性格、互动偏好和服务连接拆成可理解的步骤。
- 角色通过能力词表说明自己会哪些动作，形象切换后能力也更新。
- 互动事件与行为执行分开，静音/安静等能力明确可控制。
- 记忆有可读文本与历史的思路，后续若做记忆，应让用户能看、能改、能清空。

以上均为设计参考，不是当前功能承诺。产品说明中的模型服务与联网能力有独立费用、数据流和配置要求；不能将软件开源理解为所有 AI 能力免费或离线。

### 与现有模型的差异

其内置鲸鱼的 [figure.js](https://github.com/Pal-AI-Lab/Coopanion/blob/main/packages/cortico-world-desktop-pet/web/whale/figure.js) 说明使用 sprite rig、弹簧与自定义画布绘制，不是本项目用户提供的那套 moc3 导出模型。形象包协议允许工厂读取包内 moc3 等资源，但仍需相应的渲染和行为实现。不能承诺把现有模型文件直接放进去就具备全部能力。

我们的可迁移目标仍是：用户直接导入自己的 Cubism 模型，校准参数、表情和动作，再逐步接入声音与对话。

### 许可边界

本次读取 [LICENSE](https://github.com/Pal-AI-Lab/Coopanion/blob/main/LICENSE) 为 **AGPL-3.0-or-later**，另有 Steamworks 组合的附加许可。它不是 MIT；不能把其实现直接复制进本项目后继续称全部为纯 MIT。当前只记录设计与公开接口思路，尚未引入对方代码或素材；若以后选择复用，先单独评估对应许可义务与项目授权方案。

## 推荐顺序

按 [项目企划书](PROJECT_PLAN.md) 先完成 P1 运行地基，再做 P2 最小事件内核。角色能力契约在 P2 定义，完整参数工作台安排在 P6；引导、音画同步等按所属阶段评估。插件市场、复杂记忆、电脑操作与跨平台等不因外部项目已有就同步开发。
