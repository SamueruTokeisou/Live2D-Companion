# Live2D Companion

一个从零基础爱好出发、免费优先的单角色伙伴项目，目前以 Windows Live2D 桌宠为开发基础。

长期目标是让普通 AI 对话与事件调度独立于身体，逐步接入自己的 Live2D 或其他形象。先打好运行地基，再建设最小内核；完整规划见 [项目企划书](docs/public/PROJECT_PLAN.md)。

当前为 **0.4.2-dev**。基于 [FULASKA Live2D Stage v1.1.0](https://github.com/FULASKA/-live2d-/releases/tag/v1.1.0) 的 MIT 代码进行改进，并增加角色管理与通用模型适配。模型不是本项目原创，也不随仓库分发。

## 已经能做什么

- 本地显示 Live2D 角色，透明窗口、置顶、移动和缩放。
- 中文角色管理器：单实例、启停互斥、导入进度与取消、分别保存设置。
- 导入失败回滚；带版本的配置、有效备份和损坏恢复。
- 导入前检查缺失文件，保留原件，只处理本地副本。
- 把副本大贴图限制到最长边 2048，降低常驻资源需求。
- 大肥鱼专属适配：表情、分区互动、待机和手势。
- 通用角色模式：已有标准参数的视线、眨眼、呼吸、点击反馈和模型表情。
- 30/60 帧设置；隐藏后停止出帧。
- 文字对话改为 ChatGPT 官方登录授权：直接使用套餐额度，无需 Codex 或 API 密钥；已改为中文输入、日语回答与日文字幕；本机已完成一轮真实日语回应。
- P2 本地内核测试：事件合并、优先级、暂停、停止、免打扰与身体文字接口；默认关闭，尚未接入 AI。

大肥鱼与 Live2D 官方 Haru 已在一台 Windows 电脑实际显示并完成切换。P1 已完成 8 小时连续采样且未记录故障，但存在持续内存增长，休眠恢复、多屏和其他 DPI 仍待验收。P2 工程测试已接入现有舞台。详见 [验证状态](docs/public/VALIDATION.md)。

**尚未实现：** 语音识别、完整的语音与口型同步、跨平台和完整的可视化角色适配器。

当前取舍：普通 AI 对话，不额外设置固定人格或长期记忆。最近三轮成功对话仅保留在本进程，清空、切换账号或退出后不恢复；P4 已移出必经阶段。

可选日语朗读正在接入本地 GPT-SoVITS，见 [P5 安装与限制](docs/public/P5_VOICE_SELECTION.md)。整句文字后朗读不等于流式语音或同步口型；基础桌宠不依赖语音环境。

## 安装与启动

环境：Windows 10/11 x64；Python 3.11+（包含 Tkinter 和 venv）。目前无需 Node.js 或编译工具即可使用安装流程。

1. 下载本仓库 ZIP 并解压，或 `git clone`。
2. 在项目目录用 PowerShell 运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup.ps1
   ```

   这里的执行策略仅作用于本次进程，不修改系统永久策略。脚本创建本地 `.venv`，安装 Pillow，下载约 151 MiB 的指定上游运行包，校验 SHA256，再应用仓库中的代码改动。无需管理员权限。请先关闭本项目的桌宠再重新运行安装脚本。

3. 双击 `Start.cmd` 打开角色管理器。
4. 选择“导入新角色”，提供你有权使用的完整 `.model3.json` 模型。
5. 导入完成后点“启动 / 切换”。

运行包包含上游使用的 Electron/Cubism 组件，相关许可独立于本仓库 MIT 代码。安装器从上游下载运行包，不在本仓库重新发布它。若下载受限，按 [安装说明](docs/public/INSTALL.md) 手动准备同版本文件。

已知大肥鱼导出版本按 moc3 指纹自动选择专属模式；其他模型进入通用模式。非标准参数、特殊转头方向和专属动作仍需适配。旧 Cubism 2 `.model.json` 暂不支持。

## 基本操作

| 操作 | 效果 |
| --- | --- |
| 左键点击 / 轻移 | 角色互动；具体反应依模式而异 |
| 按住中键或右键拖动 | 移动桌宠 |
| Shift + 滚轮 | 缩放 |
| 管理器 → 文字对话 | 通过 Continue with ChatGPT 授权后交流，可停止和清空 |
| 管理器 → 内核测试 | 打开明确标注的本地规则测试，支持暂停和停止 |
| 管理器 → 桌宠设置 | 表情、跟随、帧率和窗口设置 |
| Ctrl + Alt + L | 切换鼠标穿透 |
| Ctrl + Alt + Q | 退出桌宠 |
| 托盘图标 | 隐藏 / 显示、设置、退出 |

当前推荐手动启动；开机自启入口暂不开放。基础功能不需要 API，不使用麦克风。可选文字对话使用官方 Sign in with ChatGPT，需要本人完成登录和套餐授权。占用适用的会员额度，不自动切换 API 付费；新路径已观察到真实回应，完整验收仍见 P3 文档。

## 开发与维护

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Node.js 24 用于 JavaScript 语法检查与舞台调试。`source/desktop-v1.1.0` 是保留来源的引擎源码；`tools/pet_manager.py` 是本项目的角色管理器；`tools/setup.py` 将列出的本地改动部署到已校验的运行包。

- [项目企划书](docs/public/PROJECT_PLAN.md)：分阶段规划、验收门槛与下一轮任务。
- [P5 声音选型](docs/public/P5_VOICE_SELECTION.md)：本地语音候选、试听入口与分步验收。
- [P3 文字对话](docs/public/P3_CONVERSATION.md)：现有登录、调用限制、真实后端与数据边界。
- [P2 内核与体验方法](docs/public/P2_KERNEL.md)：本地测试入口、能力边界与验收。
- [P1 实施与验收](docs/public/P1_FOUNDATION.md)：当前交付、配置恢复和长测方法。
- [路线图](ROADMAP.md)：当前进度与阶段摘要。
- [玩法与灵感](docs/public/IDEAS.md)：社区项目参考与本项目构想。
- [架构](docs/public/ARCHITECTURE.md)：代码入口、角色隔离和技术债。
- [维护约定](docs/public/MAINTENANCE.md)：需求、开发、测试和发布节奏。
- [参与贡献](CONTRIBUTING.md)：提交问题与改动。

## Contributors

| 贡献者 | 角色与贡献 |
| --- | --- |
| [SamueruTokeisou](https://github.com/SamueruTokeisou) | 项目发起人、维护者与产品负责人：决定方向、体验与发布。 |
| OpenAI Codex（AI 协作者） | 执行与技术协作：需求拆解、架构设计、代码实现、测试验证、文档与维护规划。由项目维护者发起工作并审核结果。 |
| [FULASKA 及上游贡献者](https://github.com/FULASKA/-live2d-) | 提供本项目衍生的 Live2D Stage 引擎基础，原始许可与署名保留。 |

欢迎通过 Issue 和 Pull Request 参与；后续实际贡献会持续记录。

## 许可与来源

本项目代码使用 [MIT](LICENSE)。保留 FULASKA 及其依赖的署名；第三方声明见 [NOTICE](NOTICE.md)。大肥鱼的原画及拆分为神宫凉子，官方建模为霓虹猫_NeonNeko；模型请自行向原作者获取并遵守使用须知。

**模型、PSD、贴图、Cubism Core、语音素材和模型权重不由本仓库 MIT 许可覆盖。** 不要在 Issue 或 PR 上传完整模型；描述问题时请使用脱敏日志或合法的小型复现材料。
