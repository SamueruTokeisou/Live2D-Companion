# 安装说明

## 标准安装

安装包含 Tkinter 和 venv 的 Python 3.11+，解压或克隆仓库，在项目目录运行 `Setup.ps1`。它只使用项目目录与用户网络连接，不需要管理员权限，不修改其他 Agent 配置。

脚本创建 `.venv`，从 PyPI 安装 Pillow，再从 FULASKA 的指定 release 下载运行环境，核对 SHA256，复制本项目修改。首次下载约 151 MiB，解压后需要更多磁盘空间。

完成后双击 `Start.cmd`，选择“导入新角色”。没有模型时不会凭空生成角色；请自行取得有权使用的模型，保留完整导出结构。

## 网络受限时

从 [上游 v1.1.0 发布页](https://github.com/FULASKA/-live2d-/releases/tag/v1.1.0) 下载 `dafeiyu-live2d-pet-v1.1.0-win32-x64.zip`，放入本项目 `downloads/desktop-v1.1.0.zip`，再运行安装脚本。

预期 SHA256：`42f2e876c78c67f374c2fb9bbdad6566b4e84860630a62585bb8e4e4558d1e30`。校验失败时停止，不跳过检查。

## 维护者已安装目录

已有本地安装可继续使用原来的桌面快捷方式，不必为了上传源码重新安装。新的克隆目录使用 `Setup.ps1` 与 `Start.cmd`，不会包含维护者本地模型、配置和快捷方式。

## 升级

先退出桌宠，备份 profiles 和 data，再更新代码并运行安装脚本。模型副本位于 models，不随 Git 更新。当前版本尚未提供完整自动回滚，重要配置请自行保留副本。
