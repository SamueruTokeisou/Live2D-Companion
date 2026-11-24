import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createNativeCore } = require('./index.cjs')
const core = createNativeCore()
const MODEL = process.env.CUBISM_TEST_MODEL || ''
if (!MODEL) throw new Error('Set CUBISM_TEST_MODEL to a local licensed moc3 file')
const b = fs.readFileSync(MODEL)
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
const m = core.Model.fromMoc(core.Moc.fromArrayBuffer(ab))
const i = m.getParameterIndex('ParamAngleX')
const j = m.getParameterIndex('ParamBreath')
const log = (...a) => process.stderr.write(a.join(' ') + String.fromCharCode(10))
log('index', i, j, 'default', m.parameters.values[i], m.parameters.defaultValues[i])
m.parameters.values[i] = 20
m.parameters.values[j] = 0.7
m.update()
log('after update: AngleX=', m.parameters.values[i], ' Breath=', m.parameters.values[j])
m.update()
log('after 2nd update: AngleX=', m.parameters.values[i], ' Breath=', m.parameters.values[j])
