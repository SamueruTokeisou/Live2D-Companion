// 独立验证：不经引擎，直接用原生桥加载大肥鱼模型并计时。
// 跑法：ELECTRON_RUN_AS_NODE=1 <electron.exe> test.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createNativeCore } = require('./index.cjs')

const NL = String.fromCharCode(10)
const log = (...a) => process.stderr.write(a.join(' ') + NL)
const MODEL = process.env.CUBISM_TEST_MODEL ||
  'C:/Users/33153/Desktop/DeepSeek免费公皮/DeepSeek/_opt2048/大肥鱼.moc3'

const core = createNativeCore()
log('[core]', JSON.stringify(core.__info))

const t0 = performance.now()
const bytes = fs.readFileSync(MODEL)
log('[read]', (bytes.byteLength / 1048576).toFixed(1) + 'MB')
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
const moc = core.Moc.fromArrayBuffer(ab)
if (!moc) throw new Error('Moc.fromArrayBuffer 返回 null')
log('[moc] 一致性=' + moc.hasMocConsistency)

const model = core.Model.fromMoc(moc)
if (!model) throw new Error('Model.fromMoc 返回 null')
const tLoad = performance.now() - t0

const d = model.drawables
const p = model.parameters
log(`[model] drawables=${d.count} parts=${model.parts.count} params=${p.count} 载入 ${tLoad.toFixed(0)}ms`)
log('[canvas]', JSON.stringify(model.canvasinfo))
log('[params] 前 3 个:', p.ids.slice(0, 3).map((id, i) => `${id}=${p.values[i].toFixed(3)}`).join(' '))
log('[pos] 首 drawable 顶点数=', d.vertexCounts[0], ' buffer=', d.vertexPositions[0].length)

const angleX = model.getParameterIndex('ParamAngleX')
const angleY = model.getParameterIndex('ParamAngleY')
const breath = model.getParameterIndex('ParamBreath')
log('[probe] ParamAngleX ->', angleX, 'ParamAngleY ->', angleY, 'ParamBreath ->', breath)

for (let i = 0; i < 10; i++) model.update()

const samples = []
let sig = null
for (let i = 0; i < 120; i++) {
  const t = i * 0.033
  if (angleX >= 0) p.values[angleX] = Math.sin(t) * 20
  if (angleY >= 0) p.values[angleY] = Math.cos(t) * 15
  if (breath >= 0) p.values[breath] = 0.5 + 0.5 * Math.sin(t * 2)

  const s = performance.now()
  model.update()
  samples.push(performance.now() - s)

  if (i === 60) sig = Array.from(model.drawables.vertexPositions[0].slice(0, 4))
}
samples.sort((a, b) => a - b)
const med = samples[samples.length >> 1]
const avg = samples.reduce((a, b) => a + b, 0) / samples.length
log(`[update] 中位 ${med.toFixed(2)}ms  平均 ${avg.toFixed(2)}ms  最差 ${samples[samples.length - 1].toFixed(2)}ms`)

log('[sig] 首 drawable 前 4 个坐标:', JSON.stringify(sig))
log('[flags] dynamicFlags[0] =', d.dynamicFlags[0], ' renderOrders[0..3] =', JSON.stringify(Array.from(d.renderOrders.slice(0, 4))))

if (angleX >= 0) {
  p.values[angleX] = 9999
  model.update()
  log('[clamp] 设 9999 后回读 =', p.values[angleX].toFixed(3))
}

model.drawables.resetDynamicFlags()
log('[reset] dynamicFlags[0..3] =', JSON.stringify(Array.from(model.drawables.dynamicFlags.slice(0, 4))))
