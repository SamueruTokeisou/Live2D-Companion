# 架构与开发入口

更新2026-11-24。当前主线为桌宠基础，见[企划2.1](PROJECT_PLAN.md)。本页区分实际代码和目标结构，避免规划冒充实现。

## 当前实际运行

Python/Tkinter角色管理器负责模型副本导入、角色档和舞台启停；Electron舞台显示Live2D并承载对话窗口。事件内核和ChatRuntime在主进程工作，通过固定RPC向身体发送文字、音频及停止。ChatGPT授权对话后端与本机GPT-SoVITS服务分开，语音服务由StartVoice/StopVoice显式控制。

- `tools/pet_manager.py`：角色导入、设置、本地控制和中文管理器。
- `tools/setup.py`：校验上游运行包、覆盖列出的本项目改动；是过渡安装机制。
- `source/desktop-v1.1.0/app/main.mjs`：舞台/子窗口、本地控制和当前对话集成。
- `app/kernel/event-kernel.mjs`、`chat-runtime.mjs`：事件、任务、取消、近期上下文与用量。
- `app/kernel/chatgpt-auth.mjs`、`chatgpt-provider.mjs`：官方登录、凭据保护、模型目录与流式文字。
- `app/kernel/local-speech.mjs`、`body-port.mjs`：本地中文参考合成与按任务代次播放/停止。
- `app/renderer.js`、`generic.js`、`src/stage/`：专属/通用身体、动作和渲染。
- `src/server/stage-server.mjs`：回环控制与静态资源服务；控制安全模块验证启动凭证、来源与文件边界。
- `tools/setup_voice.py`、`voice_service.py`、`voice_preview.py`：语音包校验、所属进程管理及私有试听。
- `tests/`与CI：现有Python/Node回归；当前增加请求边界与身体表现测试。

上述app/src相对路径均在source/desktop-v1.1.0下。models、profiles、data、runtime、downloads、validation等实际私有目录被Git忽略。当前没有直播平台连接、观众存储、联网搜索、歌声生成或OBS控制实现。

## 构建、组件与素材

现有安装依赖上游编译运行包，尚无本项目从干净源码形成同一运行物的完整验证。scripts/pack.mjs可作为起点，仍需解决锁定依赖、Cubism组件取得、版本清单与新目录打包。后续基础阶段需完成依赖盘点、源码启动、可追溯构建与安装回归；不把“有打包脚本”当完成证据。

保留现有D中文参考配置；音色不注入绫华人格。公开直播前对模型、声音和歌曲作具体来源审查，必要时换有明确使用依据的资产。第三方代码、前端、权重与样例素材分别核对许可，独立进程不是许可豁免。

## 当前优先技术债

1. 日常控制和失败反馈尚需系统验收。
2. 源码构建闭环及上游/自有差异管理尚未完成。
3. renderer.js职责过多，本次仅提取对话表现模块。
4. 历史内存增长仍需定位和持续采样；休眠、多屏覆盖未完成。

直播、唱歌与观众记忆只保留未来方向，具体设计在用户选择实施时重新评估。

历史测试与现场观察继续放[VALIDATION](VALIDATION.md)，新需求和验收以企划书为准。

## 当前桌宠基础增量（2.1）

`src/server/control-security.mjs`管理随机启动凭证、Host/Origin、真实路径边界和HTTP操作白名单。`app/kernel/conversation-adapter.mjs`按实际播放音频能量控制标准嘴部参数；大肥鱼额外笑容仅在专属模式启用。每帧绘制后恢复参数，避免偏移累积。`body-port.mjs`负责气泡、播放分析、任务取消和停止清理。复杂情绪、音素口型和直播控制尚未实现。

## 0.4.5 本地对话修复

`app/runtime-paths.mjs`将PROFILE_HOME（角色设置/日志/集成文件）与共享的Electron加密及浏览器上下文分开。管理器提供共享授权目录与旧加密上下文入口；首次升级只复制旧Local State中的OS保护密钥字段到共享browser-state，不复制浏览历史、不解密写出凭据、不覆盖已有密钥，保留旧文件。已有账号但缺少迁移上下文时，保留记录并禁用云登录读取，离线桌宠仍启动。

`body-port.mjs`在启用语音时提前创建并复用AudioContext，播放走浏览器异步base64解码，并在异步完成后再次检查任务归属。关闭语音的新进程不预热；设备生命周期随窗口结束。仅暴露设备准备状态和阶段耗时，不发送参考音频路径或账号信息到角色页面。

专属与通用模式共用有上限的故障记录；长帧保留音频状态、帧耗时及近期JS长任务时长，阈值仍为120毫秒。没有长任务记录不证明系统或GPU必然是根因。

## 0.4.6 声音日常控制

LocalSpeech的有效配置与启用状态分别读取，音量更新保留参考、语言及启用开关。chat:volume持久化后通过内部body:volume应用到当前播放器；新音频到达前重新读取最新音量，避免等待合成期间的调节被旧值覆盖。HTTP仅开放受限chat:volume与chat:voice-status，不开放直接身体执行。

语音服务检查使用固定回环地址/openapi.json、1.5秒期限、单次并发合并，验证/tts的POST定义；不触发合成或启动。状态与错误不包含私有参考路径。通用模型现场脚本仅操作所有者已经选择的通用模型，不能自动导入测试样例。
