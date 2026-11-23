# P3 文字对话：使用与验收

更新：2026-11-23。版本：0.4.1-dev。按用户要求，默认后端改为 **Sign in with ChatGPT → Responses API**，不启动 Codex。该路径已完成自动检查；真实账号登录、授权及模型回应仍待用户亲自操作验收。0.4.0 的旧 Codex 实测不能证明新路径可用。P1 遗留问题仍保留。

## 如何使用

1. 正常启动角色，在管理器点击“文字对话”。
2. 点击 **Continue with ChatGPT**。在系统浏览器的 OpenAI 官方页面亲自登录，并明确授权使用套餐额度。未授权时不能发起对话。
3. 返回桌宠，首次授权后阅读“正在使用 ChatGPT 套餐”，点击 Got it。程序读取账号当前可用模型；可以刷新或选择模型。
4. 发送文字；看到完整响应后才标为“真实后端已验证”。停止、直接发送新一句、关闭窗口都会取消任务。失败或部分输出不写入后续上下文。
5. 可以切换已登记账号或退出。切换账号会清空近期对话；退出会先清除本机凭据，再尝试撤销远程刷新会话。撤销失败会提示到 ChatGPT 设置断开应用。

基础桌宠保持离线可用。点击、待机和本地内核测试不调用云端。普通启动和仅打开聊天窗口不生成模型回应。不提供自动付费回退。

## 费用与隐私

这不是“完全不消耗 token”：模型仍处理 token，桌宠使用经用户授权的适用 ChatGPT 套餐额度，与其他适用应用共享限制。无需 API 密钥，不产生本程序主动发起的独立 API 密钥账单。用户自行购买或授权的额外额度应在 ChatGPT 用量设置管理。额度不足立即停止，不自动重试。

每轮只提交最近三轮成功对话和本轮文字；只做文字聊天，没有工具执行、电脑操作、文件读取、声音或长期记忆。服务端按 OpenAI 设置处理数据，程序设置 store:false 不等于承诺服务端完全不处理或保留数据。

登录授权和模型访问分别检查。OAuth 使用 PKCE S256、随机 state/nonce、只绑定 127.0.0.1 的临时回调；验证 ID token 的官方签名、发行者、受众、期限和 nonce。只有身份授权不能调用模型。凭据仅在主进程使用，通过 Electron safeStorage / Windows 系统加密后原子保存；没有明文回退。账号、稳定主机标识及备份位于忽略的 data/chatgpt-auth，不进 Git。角色管理器串行启停舞台，共用一个本机账号档；不支持绕过管理器同时运行多个共享账号存储的舞台。

## 本地限制

每分钟最多6轮、单次进程最多24轮；每轮最多一次推理请求，45秒超时，输入与输出各500字符。输出超限会主动停止并标为未完成。短回应提示不能保证模型一定短；已生成内容即使取消也可能计入额度。金额无法从 token 数可靠推算，窗口只显示已知用量，未知项明确标记。清空对话不重置次数。

模型目录来自当前账号、保留官方顺序并过滤可展示项。推理仅请求 https://api.openai.com/v1/responses，必须收到 response.completed 才成功；中途额度失败、断流及不完整结果均为失败。没有抓取 ChatGPT 网页，也没有读取 Codex 登录文件。

## 验证与剩余工作

新增10项自动测试覆盖：PKCE与动态 client_id、错误state和拒绝授权、JWT签名与关键声明、无套餐权限、刷新轮换与并发退出、防止明文存储、拆分UTF8/CRLF的SSE、终态与迟到额度错误、HTTP拒绝且不重试。原P2/P3/配置及Python回归继续运行。

尚待真实用户完成：官方登录和授权、Windows加密持久化后重启、目录加载、中文完整回应、停止与额度错误。未完成前不声明新版通过G3或正式发布。

## 官方依据

- [Sign in with ChatGPT 快速开始](https://developers.openai.com/siwc/quickstart)
- [开源客户端登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

## 历史证据

0.4.0-dev 使用 Codex App Server / CLI 0.164.0，完成中文多轮、流式、停止及恢复的本机基础检查。旧 provider 源码与协议测试保留供追溯；当前主程序不导入或自动回退到它。历史验收不转移到新的直接登录后端。

## 普通对话与记忆取舍

2026-11-23 所有者选择普通 AI 对话，不增加固定角色人格、性格档或长期记忆。现有简短中文回应与长度约束属于界面输出约束，不是角色人格系统。最近三轮成功对话只用于本次交流连贯性；没有调用 ChatGPT 网页历史或个人记忆，也不会自动继承它们。P4 已移出当前必经阶段，本轮未改动后端或启动 P5。
