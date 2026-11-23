# 来源与第三方声明

## 引擎来源

本仓库包含从 [FULASKA/-live2d- v1.1.0](https://github.com/FULASKA/-live2d-/releases/tag/v1.1.0) 源码包衍生的代码。原始代码许可为 MIT，原版权声明完整保留在 `source/desktop-v1.1.0/LICENSE`。本项目不是该上游的官方版本。

指定运行包 SHA256：`42f2e876c78c67f374c2fb9bbdad6566b4e84860630a62585bb8e4e4558d1e30`。
指定源码包 SHA256：`dbcd141bcaf41a20dd95fd4af4ce649338f777cfb66f85b8b1`。

本地新增与修改：角色管理器、安装器、通用角色适配、独立角色状态、30/60 帧、Shift 缩放、热区缩放修复、模型清单读取与去重、文档和测试。保留上游源码的原有注释不表示其中的历史测量或版本计划已经在本项目重新验证。

## 素材与运行组件

- 大肥鱼：原画与拆分 神宫凉子；官方 Live2D 建模 霓虹猫_NeonNeko。完整模型、PSD、贴图不进入仓库。
- Haru：Live2D Inc. 所有的官方示例，用于本地兼容测试；模型不进入仓库。获取与使用遵守 [官方条款](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)。
- Cubism Core：Live2D Inc. 专有运行组件，遵守其许可，不进入本仓库。
- Electron、PixiJS、untitled-pixi-live2d-engine、Pillow 等依赖使用各自许可证。运行时保留上游包内许可证。

## 调研来源

[WHALEL2D](https://github.com/Ssssshaiiko/WHALEL2D)、[DeepFish](https://github.com/Rockau/DeepFish-desktop-pet)、[DeepFish-voice](https://github.com/ICEAXEMAN/DeepFish-voice)、[AIRI](https://github.com/moeru-ai/airi)、[Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) 用于功能与设计比较。没有因为仓库公开就将其代码视作 MIT；当前未引入 DeepFish 系列的非商业许可代码或语音素材。

## 可选对话后端

文字对话通过官方 Codex App Server 协议调用用户自行安装的 Codex CLI；不在本仓库分发 CLI 二进制、认证文件或令牌。CLI 和云端服务使用各自许可与服务规则，不由本仓库 MIT 许可覆盖。
