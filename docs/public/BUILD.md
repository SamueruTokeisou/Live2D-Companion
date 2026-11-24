# 应用源码构建

已在本机Windows验证应用源码打包、角色渲染、15项内核现场检查及现有加密登录读取。不是重新编译Electron或Cubism Core，也不保证不同机器产物逐字节一致。

## 环境和步骤

需要Python 3.11+与Pillow、Node.js 24/npm、Windows x64，以及自行取得并可在本机使用的Cubism Core。模型、Core、运行包、声音与账号不提交仓库。

在项目根执行，输出必须使用runtime/source-build下尚不存在的新目录：

```powershell
python -m pip install -r requirements.txt
python tools/prepare_source.py --core "你的本机Core路径/live2dcubismcore.min.js" --output runtime/source-build/my-build
npm ci --ignore-scripts --no-audit --no-fund --prefix runtime/source-build/my-build
node tools/build_desktop.mjs runtime/source-build/my-build
```

构建使用锁文件中的依赖和Electron 33.4.11。npm ci会下载开发依赖，打包器可能下载对应Electron；不需要购买云服务。只使用本地Core，不自动下载或变更Core许可。生成简单通用托盘图标，不带模型、训练权重、原生Beta或诊断实验目录。

程序位于`runtime/source-build/my-build/out/Live2D-Companion-win32-x64/Live2D-Companion.exe`。输入文件哈希/Core哈希记录在build-inputs.json，结果在build-result.json；都只留本地。构建以工作区文件为准，commit标识外还应核对逐文件哈希；未提交工作区不等于该commit的干净产物。

## 本机验收

当前仅使用所有者已有的大肥鱼角色，不下载示例。已有本地角色和登录时：

```powershell
python tools/acceptance_source_build.py runtime/source-build/my-build/out/Live2D-Companion-win32-x64/Live2D-Companion.exe
```

脚本临时退出当前桌宠，在独立本地角色数据目录启动新构建，检查实际渲染、文字/取消/暂停/计时和加密登录可读；不发送云请求，结束恢复原桌宠。详细回执在私有validation目录。没有本地角色或登录的开发者可先完成普通安装/导入；此现场脚本不能代替陌生机器安装测试。

普通安装器暂仍使用固定校验上游运行包加文件补丁；本轮没有静默替换默认引擎。源码构建是已验证的独立入口。公开发行前仍需核对组件许可、干净机器安装、休眠及长期资源行为。
