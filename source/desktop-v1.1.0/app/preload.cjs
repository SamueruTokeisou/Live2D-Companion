// 预加载：只暴露壳层能力，渲染层拿不到 node。
//
// 三个页面共用这一份：舞台（覆盖层）/ 设置窗口 / 动作编辑器。
// 舞台窗口额外提供「全局光标 + DSH 状态 + 穿透」；设置窗口只用到 get/set/stageRpc。
const { contextBridge, ipcRenderer, webUtils } = require('electron')

// 安装目录：原生模块要按绝对路径找 DLL。
// 注意：窗口一旦是 sandbox=true，这里的 require('node:path') 会抛「module not found: node:path」，
// 整份 preload 直接不执行 —— 页面里 window.shell 就变 undefined，所有开关静默失效。
// 所以这里容错并**大声报错**，别再让同样的问题悄悄发生一次。
let ROOT = ''
try {
  if (!process.sandboxed) ROOT = require('node:path').dirname(__dirname)
} catch (e) {
  console.error('[preload] 取不到安装目录（窗口被沙箱化了？把 webPreferences.sandbox 设成 false）', e?.message || e)
}

const api = {
  // ---- 安装路径（原生模块要按绝对路径找 DLL）----
  paths: { root: ROOT },
  // ---- 设置（主进程持有，改动会广播给所有窗口）----
  get: () => ipcRenderer.invoke('shell:get'),
  set: (patch) => ipcRenderer.invoke('shell:set', patch),
  onSettings: (fn) => ipcRenderer.on('shell:changed', (_e, s) => fn(s)),
  // 子窗口（设置/编辑器）打开时降帧，关掉后恢复
  onThrottle: (fn) => ipcRenderer.on('shell:throttle', (_e, v) => fn(v)),
  // 舞台窗口可见性：隐藏/最小化时彻底停帧（见 renderer setStageActive）
  onStageActive: (fn) => ipcRenderer.on('shell:stage-active', (_e, v) => fn(v)),

  // ---- 舞台窗口的指令通道（设置窗口用它改反应、读快照、导出补丁）----
  stageRpc: (op, payload) => ipcRenderer.invoke('stage:rpc', op, payload),
  kernelClick: () => ipcRenderer.send('kernel:click'),
  chooseModel: () => ipcRenderer.invoke('model:choose'),

  // ---- 首次运行引导（找不到模型时打开的小窗口）----
  firstRunPaths: () => ipcRenderer.invoke('firstrun:paths'),
  firstRunOpen: (what) => ipcRenderer.invoke('firstrun:open', what),
  firstRunSetModel: (p) => ipcRenderer.invoke('firstrun:set-model', p),
  firstRunChoose: () => ipcRenderer.invoke('firstrun:choose'),
  // 拖进来的文件拿真实路径（Electron 32+ 不再允许直接读 File.path）
  pathForFile: (f) => { try { return webUtils.getPathForFile(f) } catch { return '' } },


  // ---- 窗口搬运 / 尺寸 / 轮廓 ----
  dragBegin: (sx, sy) => ipcRenderer.send('win:drag-begin', { sx, sy }),
  dragMove: (sx, sy) => ipcRenderer.send('win:drag-move', { sx, sy }),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  moveBy: (dx, dy) => ipcRenderer.send('win:move', { dx, dy }),
  bounds: () => ipcRenderer.invoke('win:bounds'),
  // 窗口尺寸跟随角色：渲染层算尺寸，主进程保持中心不变地改
  // anchor 可选：{ sx, sy, cx, cy } = 让窗口里的 (cx,cy) 落回屏幕 (sx,sy)，
  // 滚轮缩放时用它一次到位，避免「先按中心缩放、再补一次位移」的错位
  fit: (w, h, anchor) => ipcRenderer.send('win:fit', { w, h, anchor }),
  // 滚轮缩放专用通道：只搬窗口（不落盘/不广播/不刷托盘），松手后主进程统一保存
  zoom: (at) => ipcRenderer.send('win:zoom', at),
  // 拖边框缩放：报告按下的边，主进程按全局光标改 bounds（比例锁定）
  scaleBegin: (edge) => ipcRenderer.send('win:scale-begin', edge),
  scaleEnd: () => ipcRenderer.send('win:scale-end'),
  center: () => ipcRenderer.send('win:center'),
  setPassThrough: (v) => ipcRenderer.send('win:pass-through', v),
  onClickThrough: (fn) => ipcRenderer.on('shell:click-through', (_e, v) => fn(v)),

  // ---- 子窗口 ----
  openSettings: () => ipcRenderer.send('shell:settings'),
  openEditor: () => ipcRenderer.send('shell:editor'),
  quit: () => ipcRenderer.send('shell:quit'),
  restartEngine: () => ipcRenderer.send('shell:restart-engine'),
  devtools: () => ipcRenderer.send('shell:devtools'),

  // ---- 更新提醒：主进程查到新版本后推给气泡 ----
  onUpdateAvailable: (fn) => ipcRenderer.on('shell:update-available', (_e, v) => fn(v)),

  // ---- 故障报告：渲染层上报 + 一键导出（见 docs/故障排查.md）----
  fault: (kind, detail) => ipcRenderer.send('fault:report', { kind, detail }),
  rendererInfo: (info) => ipcRenderer.send('fault:info', info),
  exportDiagnostic: () => ipcRenderer.invoke('fault:export'),

  // ---- 舞台专用：全局光标位置 + DSH 工作状态 ----
  onCursor: (fn) => ipcRenderer.on('cursor:pos', (_e, p) => fn(p)),
  onAgentStatus: (fn) => ipcRenderer.on('agent:status', (_e, s) => fn(s)),

  // ---- 文件：动作 JSON / 改动补丁（都放 userData，跟应用一起搬走）----
  actionsSave: (data) => ipcRenderer.invoke('actions:save', data),
  actionsLoad: () => ipcRenderer.invoke('actions:load'),
  patchSave: (data) => ipcRenderer.invoke('patch:save', data),
  patchLoad: () => ipcRenderer.invoke('patch:load'),
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('shell', api)
} else {
  // 原生 core 模式（关闭 contextIsolation）：preload 与页面同上下文，直接挂到 window
  globalThis.shell = api
  globalThis.__installNativeCore = (opts) =>
    require(`${ROOT}/native/cubism-core/index.cjs`).installNativeCore(opts)
  // 仅原生模式（开发实验）可用的读文件口子：做 A/B 对比时读 moc3 用
  globalThis.__devReadFile = (p) => require('node:fs').readFileSync(p)
}
