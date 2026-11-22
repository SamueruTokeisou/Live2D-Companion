# 原生 Cubism Core（N-API 桥）

用官方 `Live2DCubismCore.dll`（C API）替换掉 WASM 版核心，**引擎代码一行不改**：
本目录把一个同形的 `Live2DCubismCore` 对象装到全局，`untitled-pixi-live2d-engine`
（以及 pixi7 + mulmotion 分支）照常调用。

## 为什么值得

| 指标 | WASM 版 | 原生版 |
| --- | --- | --- |
| Core 求值 `update()` | 8.2ms（中位） | **1.7ms**（中位，最差 2.0） |
| 整帧（模型 update + 一帧绘制） | 24.5ms | 15.0ms（pixi8）/ **12.7ms**（pixi7） |
| 帧率 | ~41fps | 67–79fps |

同机同模型（715 drawable / 509 参数 / 5 张 4096 贴图），50 帧中位数。

**正确性**：同参数下逐顶点对比官方 WASM 版，
58967 个顶点最大误差 **0**，参数钳制、不透明度、乘法色、渲染顺序、动态标志全一致。

## 结构

```
native/cubism-core/
  cubism_core.cc      # N-API 模块：加载 DLL、建 moc/模型、每帧集中搬运数据
  build-mingw.sh      # 构建脚本（本机没装 Windows SDK，MSVC 走不通）
  binding.gyp         # MSVC 路线备用（装了 Windows SDK 才能用）
  index.cjs           # JS 皮：组装成官方 Live2DCubismCore 的外形
  test.mjs            # 独立验证：加载模型 + 计时 + 钳制检查
  vendor/Live2DCubismCore.dll
  build/cubism_core.node
```

## 接口映射（只做引擎真正用到的那部分）

- `Moc.fromArrayBuffer` → `csmReviveMocInPlace`（缓冲区按 64 字节对齐复制）
- `Model.fromMoc` → `csmGetSizeofModel` + `csmInitializeModelInPlace`
- `model.update()` → 一次跨边界：JS 参数值 memcpy 进原生 → `csmUpdateModel` →
  动态数据（顶点/不透明度/flags/渲染顺序/乘法色/屏幕色）memcpy 回 JS 缓冲
- `parameters` / `parts` / `canvasinfo` / `drawables` 静态部分在建模时一次性导出成普通 JS 数组
- `parameters.values` 是**活数组**：引擎直接写它，`update()` 时整块推给原生
- 参数读写、`getParameterIndex` 全在 JS 侧做（走 Map），不再每帧几百次跨边界调用

### 三个必须按官方语义来的坑

1. `csmResetDrawableDynamicFlags` 是「重置回初始状态」，**可见位仍然为 1**。
   第一版实现成把 JS 侧 flags 清零，结果 715 个 drawable 全被判为不可见 → 画面全透明、
   0 次 draw call（但 rAF 依旧 100+ fps，很有迷惑性）。现在改为重置后从原生回读。
2. `csmGetVersion()` 返回 `unsigned int`（如 `0x06000001` → `06.00.0001`），不是字符串。
3. `update()` 拿到的参数是 **Float32Array**（引擎的 `parameters.values`），
   `napi_get_arraybuffer_info` 对 TypedArray 会失败——第一版因此一声不响地跳过了参数拷贝，
   模型永远按默认值求值、角色完全不动（但画面、帧率、绘制次数全都正常）。
   现在统一走 `GetBytes()`：ArrayBuffer 与 TypedArray 都认。

另外：**帧间读 `parameters.values` 恒为定值是正常的**。引擎每帧
`saveParameters() → 写参数 → core.update() → loadParameters()`，动画结果在
`core.update()` 那一步已经烘进顶点，随后基础值被还原。要判断“有没有在动”，
应当看顶点或截图像素，而不是参数回读。

## 构建（本机现状）

本机 VS2022 缺 Windows SDK，`node-gyp` 走不通，所以用 MinGW：

```bash
bash native/cubism-core/build-mingw.sh
```

脚本会：从 `electron.exe` 的导出表里抽出 `napi_*`/`node_api_*` 符号 → 生成最小导入库 →
`g++ -shared` 出 `cubism_core.node`。同一个产物在 Electron 与
`ELECTRON_RUN_AS_NODE=1` 下都能加载（导入表指向 `electron.exe`）。

自测：

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe native/cubism-core/test.mjs
```

## 怎么开启

优先级：环境变量 > 设置。

- 环境变量：`STAGE_NATIVE_CORE=1`
- 或 设置窗口 → 性能 → 勾选「原生 Cubism Core」（**需重启舞台**）

实现上需要两件事，缺一不可：

1. 舞台窗口 `sandbox:false`（沙箱下 `nodeIntegration` 会被忽略）
2. `contextIsolation:false`，让 preload 把 `__installNativeCore` 挂进页面世界
   —— 只用 `nodeIntegration:true` 时，带 `contextIsolation` 的页面拿不到 `require`，
   而 ESM 里的 `import 'node:module'` 会被 Chromium 的模块加载器拦掉

所以 JS 皮是 **CJS**（`index.cjs`），由 preload 用 `require` 加载。这些都只在原生模式下生效，
默认配置（WASM 版）不受影响。

## 已知边界

- 目前只覆盖引擎用到的接口；`Lifecycle` 只做了 `csmHasMocConsistency`，`Memory` 是空实现
- 遮罩/UV/索引是创建时一次性拷贝，模型运行期不变，够用
- DLL 来自 Cubism SDK for Native（本机 `live2d-stage-beta/vendor/native-sdk`），
  对外分发前需按 Live2D 许可确认（个人/小规模商用免费）
