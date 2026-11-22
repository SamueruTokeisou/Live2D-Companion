# 架构与开发入口

当前是“Python 管理器 + Electron 舞台”的过渡架构，不是从头实现的 Live2D 引擎。

```mermaid
flowchart LR
  User[用户] --> Manager[角色管理器]
  Manager --> Import[校验与副本优化]
  Import --> Profiles[本地角色档]
  Manager --> Stage[Electron 舞台]
  Stage --> Adapter{角色模式}
  Adapter --> Dedicated[大肥鱼专属行为]
  Adapter --> Generic[标准参数通用行为]
  Profiles --> Stage
  Stage --> Runtime[Cubism 与 Pixi 运行组件]
```

## 目录

- `tools/pet_manager.py`：导入、角色档、独立设置、本地启停和中文界面。
- `tools/setup.py`：固定上游版本与校验，部署本地修改。
- `source/desktop-v1.1.0/app/main.mjs`：窗口、托盘、设置和本地控制入口。
- `source/desktop-v1.1.0/app/renderer.js`：专属模式与模式分流。
- `source/desktop-v1.1.0/app/generic.js`：标准参数通用模式。
- `source/desktop-v1.1.0/src/stage/`：引擎、动作、表情、物理与互动。
- `source/desktop-v1.1.0/src/server/stage-server.mjs`：只绑定回环地址的模型与控制服务。
- `tests/`：不需要真实模型的导入与安装边界测试。

`models/`、`profiles/`、`data/`、`runtime/` 是运行时生成目录，不进入 Git。控制口令、endpoint、用户动作和偏好均为本地数据。

## 角色适配

已知大肥鱼导出版本按 moc3 SHA256 选择专属模式，避免仅凭文件名误用特殊参数。未知版本或其他角色进入 generic。

通用模式会检查参数存在性并按运行范围限制写入，只使用标准转头、视线、呼吸与眨眼参数。它不是全自动重建绑定，也没有实现任意参数别名映射。

## 目标架构与实施顺序

以 [项目企划书](PROJECT_PLAN.md) 为准，当前目录图描述的是已存在实现，下面是尚未实现的目标：

1. P1 先处理安装、启停、导入事务、配置恢复与长时验证。
2. P2 引入独立事件、状态机、任务取消与语义身体契约，通过适配器连接现有舞台。
3. P3 接一个真实对话后端，验证流式输出、打断、用量限制和服务故障降级。
4. P4 增加用户可确认、查看和清空的持久记忆。
5. P5 建立共用时钟与任务的声音链。
6. P6 再完成参数映射和身体工作台，逐步迁移现有硬编码。

拟以 Node/TypeScript 承载新内核，Python 管理器先保留。具体依赖在实施阶段核对；不因新规划而一次性重写现有程序。3D 只预留契约，未实现前不声称可用。

## 当前技术债

Electron 33 与上游依赖来自指定运行包，升级和支持状态需单独审查；不应把当前安装流程当成永远无需更新。上游历史开发脚本和文档包含其他环境的路径与测量，仅作为来源材料，不是本项目的运行证明。

安装器目前覆盖列出的舞台改动，升级前应退出桌宠。正式发布前仍需扩展全新环境、DPI、多屏、休眠和长时测试。

## P1 地基增量

`tools/local_state.py` 提供配置原子写入、备份恢复和跨进程锁；管理器以角色档最后提交作为导入完成边界。舞台 `app/persistence.mjs` 串行保存带版本的设置；`app/placement.mjs` 恢复不可见位置。`local:health` 只返回固定诊断字段，`tools/health_sample.py` 在正常模式记录私人长测证据。部署文件已加入安装器 PATCHES；运行地基验收仍以 [P1 记录](P1_FOUNDATION.md) 为准。
