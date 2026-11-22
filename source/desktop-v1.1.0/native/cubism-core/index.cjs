// Cubism Core 原生桥的 JS 皮（CJS 版：渲染层用 require 加载，绕开 ESM 的 node: 解析限制）。
// 把 cubism_core.node 组装成与官方 vendor/live2dcubismcore.min.js 同形的
// Live2DCubismCore 对象，让 untitled-pixi-live2d-engine 一行不改就能用。
'use strict'

const path = require('node:path')
const { createRequire } = require('node:module')

let native = null

/** 找包根目录：优先用 dll 路径反推（经 http 加载时 __dirname 不可靠） */
function resolveBase(dllPath) {
  if (dllPath) return path.dirname(path.dirname(path.resolve(dllPath)))
  const env = process.env.CUBISM_CORE_DLL
  if (env) return path.dirname(path.dirname(path.resolve(env)))
  return __dirname
}

function toArrayBuffer(buf) {
  if (buf instanceof ArrayBuffer) return buf
  if (ArrayBuffer.isView(buf)) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  throw new TypeError('moc3 需要 ArrayBuffer 或 TypedArray')
}

const Utils = {
  hasBlendAdditiveBit: (b) => (b & 1) === 1,
  hasBlendMultiplicativeBit: (b) => (b & 2) === 2,
  hasIsDoubleSidedBit: (b) => (b & 4) === 4,
  hasIsInvertedMaskBit: (b) => (b & 8) === 8,
  hasIsVisibleBit: (b) => (b & 1) === 1,
  hasVisibilityDidChangeBit: (b) => (b & 2) === 2,
  hasOpacityDidChangeBit: (b) => (b & 4) === 4,
  hasDrawOrderDidChangeBit: (b) => (b & 8) === 8,
  hasRenderOrderDidChangeBit: (b) => (b & 16) === 16,
  hasVertexPositionsDidChangeBit: (b) => (b & 32) === 32,
  hasBlendColorDidChangeBit: (b) => (b & 64) === 64,
}

class Moc {
  constructor(buffer) {
    const ab = toArrayBuffer(buffer)
    this._ptr = native.createMoc(ab) || null
    this.hasMocConsistency = this._ptr ? native.mocIsConsistent(this._ptr) : false
  }
  static fromArrayBuffer(buffer) {
    const m = new Moc(buffer)
    return m._ptr ? m : null
  }
  _release() {
    this._ptr = null
  }
}

class Model {
  constructor(moc) {
    const d = native.createModel(moc._ptr)
    if (!d) throw new Error('csmInitializeModelInPlace 失败')
    this._h = d.handle

    const count = d.drawableCount
    const vc = d.vertexCounts
    const positions = d.positions
    const views = new Array(count)
    let off = 0
    for (let i = 0; i < count; i++) {
      const n = vc[i] * 2
      views[i] = positions.subarray(off, off + n)
      off += n
    }

    this.parameters = d.parameters
    this.parts = d.parts
    this.canvasinfo = d.canvasinfo
    this.drawables = {
      count,
      ids: d.drawableIds,
      constantFlags: d.constantFlags,
      dynamicFlags: d.dynamicFlags,
      textureIndices: d.textureIndices,
      drawOrders: d.drawOrders,
      renderOrders: d.renderOrders,
      opacities: d.opacities,
      maskCounts: d.maskCounts,
      vertexCounts: vc,
      indexCounts: d.indexCounts,
      multiplyColors: d.multiplyColors,
      screenColors: d.screenColors,
      parentPartIndices: d.parentPartIndices,
      masks: d.masks,
      vertexPositions: views,
      vertexUvs: d.vertexUvs,
      indices: d.indices,
      resetDynamicFlags: () => native.resetDynamicFlags(this._h),
    }

    this._paramIndex = new Map()
    this.parameters.ids.forEach((id, i) => this._paramIndex.set(id, i))
    this._drawableIndex = new Map()
    this.drawables.ids.forEach((id, i) => this._drawableIndex.set(id, i))
    this._partIndex = new Map()
    this.parts.ids.forEach((id, i) => this._partIndex.set(id, i))

    this._saved = new Float32Array(this.parameters.count)
    this._saved.set(this.parameters.values)
  }

  static fromMoc(moc) {
    try {
      return new Model(moc)
    } catch (e) {
      return null
    }
  }

  update() {
    native.update(this._h, this.parameters.values)
  }

  saveParameters() {
    this._saved.set(this.parameters.values)
  }

  loadParameters() {
    this.parameters.values.set(this._saved)
  }

  getParameterIndex(id) {
    const i = this._paramIndex.get(id)
    return i === undefined ? -1 : i
  }

  getParameterValueByIndex(i) {
    return this.parameters.values[i]
  }

  setParameterValueByIndex(i, v) {
    this.parameters.values[i] = v
  }

  getDrawableIndex(id) {
    const i = this._drawableIndex.get(id)
    return i === undefined ? -1 : i
  }

  getPartIndex(id) {
    const i = this._partIndex.get(id)
    return i === undefined ? -1 : i
  }

  release() {
    this._h = null
  }
}

function createNativeCore(options = {}) {
  const base = resolveBase(options.dllPath)
  if (!native) {
    native = createRequire(path.join(base, 'noop.cjs'))('./build/cubism_core.node')
  }
  const dllPath = options.dllPath || process.env.CUBISM_CORE_DLL ||
    path.join(base, 'vendor', 'Live2DCubismCore.dll')
  const info = native.load(dllPath)
  if (!info) throw new Error(`Live2DCubismCore.dll 加载失败：${dllPath}`)

  const core = {
    __native: true,
    __info: info,
    Moc,
    Model,
    Utils,
    csmParameterType: { Normal: 0, BlendShape: 1 },
    csmLogFunction: undefined,
    Lifecycle: { csmHasMocConsistency: (ab) => native.hasMocConsistency(ab, 0) },
    Version: {
      csmGetVersion: () => native.version,
      csmGetLatestMocVersion: () => native.latestMocVersion,
      csmGetMocVersion: (ab, size) => native.mocVersion(ab, size || 0),
    },
    Logging: {
      csmSetLogFunction: (fn) => { core._logFn = fn },
      csmGetLogFunction: () => core._logFn,
    },
    Memory: {
      initializeAmountOfMemory: () => {},
    },
  }
  return core
}

function installNativeCore(options = {}) {
  const core = createNativeCore(options)
  globalThis.Live2DCubismCore = core
  return core
}

module.exports = { createNativeCore, installNativeCore }
