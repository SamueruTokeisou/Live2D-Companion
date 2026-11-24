# 上游来源边界

- `companion/`：本项目自有的事件、对话、语音、身体契约、配置与窗口定位模块。
- `source/desktop-v1.1.0/`：维护中的FULASKA v1.1.0引擎分支，包含必要的界面/服务集成改动；不是原样只读快照。
- `upstream/fulaska-v1.1.0.json`：固定源码包地址、SHA256、逐文件原始哈希及未改/已改/新增分类。原版权在引擎LICENSE保留。
- `runtime/upstream/fulaska-v1.1.0/`：可按下述命令生成的本地只读原始快照；Git忽略，不重复发布原始实验路径或二进制。

取得清单所列的源码包后：

```powershell
python tools/upstream_inventory.py --archive downloads/desktop-source-v1.1.0.zip --materialize
python tools/upstream_inventory.py
```

首次生成后不覆盖该快照。升级或修改原先未改的上游文件时，审查差异后用固定校验源码包重新生成清单：

```powershell
python tools/upstream_inventory.py --archive downloads/desktop-source-v1.1.0.zip --generate
```

CI检查清单覆盖和未改文件的内容。清单不是补丁自动合并器，当前仍以Git维护引擎分支，安装器覆盖部署文件；后续升级依然需要三方审查，不宣称整文件覆盖问题已完全消失。当前开发/构建入口见根目录docs/public/BUILD.md。上游docs仅为历史参考，不代表本机测量。
