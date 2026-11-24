(async () => {
  const MODEL = window.CUBISM_TEST_MODEL; if (!MODEL) throw new Error('Set window.CUBISM_TEST_MODEL explicitly')
  const nativeCore = window.Live2DCubismCore
  if (!nativeCore || !nativeCore.__native) return { error: '当前不是原生核心' }

  // 在隔离子页面里装载官方 WASM 版（不会污染当前页的全局）
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.srcdoc = '<!doctype html><script src="/vendor/live2dcubismcore.min.js"><\/script>'
  document.body.appendChild(iframe)
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('iframe 超时')), 15000)
    iframe.addEventListener('load', () => { clearTimeout(t); setTimeout(resolve, 300) }, { once: true })
  }).catch((e) => ({ err: e.message }))
  const wasmCore = iframe.contentWindow.Live2DCubismCore
  if (!wasmCore) return { error: 'wasm core 未加载（iframe 为空）' }

  const buf = globalThis.__devReadFile(MODEL)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const mk = (core) => {
    const moc = core.Moc.fromArrayBuffer(ab.slice(0))
    if (!moc) throw new Error('moc 失败')
    const model = core.Model.fromMoc(moc)
    if (!model) throw new Error('model 失败')
    return model
  }
  const a = mk(nativeCore)
  const b = mk(wasmCore)

  const n = a.parameters.count
  if (n !== b.parameters.count) return { error: `参数数不同 ${n} vs ${b.parameters.count}` }
  // 确定性参数：用 id 的哈希铺满整个合法区间（含边界外，测钳制）
  let h = 2166136261
  for (let i = 0; i < n; i++) {
    h = (h ^ i) * 16777619 >>> 0
    const t = (h % 10000) / 10000
    const raw = 1.4 * t - 0.2 // 有 20% 落在区间外，顺带测钳制一致性
    a.parameters.values[i] = raw
    b.parameters.values[i] = raw
  }
  a.update()
  b.update()

  // 1) 参数钳制一致性
  let paramDiff = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a.parameters.values[i] - b.parameters.values[i])
    if (d > paramDiff) paramDiff = d
  }

  // 2) 逐 drawable 顶点对比
  const da = a.drawables, db = b.drawables
  if (da.count !== db.count) return { error: `drawable 数不同 ${da.count} vs ${db.count}` }
  let maxDiff = 0, worst = null, totalVerts = 0, mismatched = 0
  for (let i = 0; i < da.count; i++) {
    const pa = da.vertexPositions[i]
    const pb = db.vertexPositions[i]
    totalVerts += pa.length / 2
    if (pa.length !== pb.length) return { error: `drawable ${i} 顶点数不同` }
    for (let k = 0; k < pa.length; k++) {
      const d = Math.abs(pa[k] - pb[k])
      if (d > maxDiff) { maxDiff = d; worst = { i, k } }
      if (d > 1e-5) mismatched++
    }
  }

  // 3) 其它动态量
  let opacityDiff = 0
  for (let i = 0; i < da.count; i++) {
    const d = Math.abs(da.opacities[i] - db.opacities[i])
    if (d > opacityDiff) opacityDiff = d
  }
  let mulDiff = 0
  for (let i = 0; i < da.multiplyColors.length; i++) {
    const d = Math.abs(da.multiplyColors[i] - db.multiplyColors[i])
    if (d > mulDiff) mulDiff = d
  }
  let orderDiff = 0
  for (let i = 0; i < da.count; i++) if (da.renderOrders[i] !== db.renderOrders[i]) orderDiff++
  let flagDiff = 0
  for (let i = 0; i < da.count; i++) if (da.dynamicFlags[i] !== db.dynamicFlags[i]) flagDiff++

  const canvasSame = a.canvasinfo.CanvasWidth === b.canvasinfo.CanvasWidth &&
    a.canvasinfo.CanvasHeight === b.canvasinfo.CanvasHeight

  iframe.remove()

  return {
    params: n, drawables: da.count, totalVerts,
    paramDiff: +paramDiff.toFixed(6),
    vertexMaxDiff: +maxDiff.toFixed(6),
    vertexMismatch: mismatched,
    worstVertex: worst,
    opacityMaxDiff: +opacityDiff.toFixed(6),
    multiplyMaxDiff: +mulDiff.toFixed(6),
    renderOrderMismatch: orderDiff,
    dynamicFlagMismatch: flagDiff,
    canvasSame,
  }
})()
