import path from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {readFile,writeFile,stat} from 'node:fs/promises'
const stage=path.resolve(process.argv[2] || '')
const workspace=path.resolve(import.meta.dirname,'..')
const relative=path.relative(path.join(workspace,'runtime/source-build'),stage)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Provide a composed source-build directory')
const require=createRequire(path.join(stage,'package.json'))
const {packager}=await import(pathToFileURL(require.resolve('@electron/packager')))
const outputs=await packager({dir:stage,out:path.join(stage,'out'),name:'Live2D-Companion',platform:'win32',arch:'x64',electronVersion:'33.4.11',asar:false,prune:true,overwrite:false,ignore:rel=>rel.replace(/^\/+/, '').split('/')[0]==='out'})
const app=path.join(outputs[0],'resources/app')
for (const f of ['app/main.mjs','companion/kernel/event-kernel.mjs','vendor/live2dcubismcore.min.js','node_modules/pixi.js/dist/pixi.mjs','node_modules/untitled-pixi-live2d-engine/dist/cubism.es.js']) await stat(path.join(app,f))
const inputs=JSON.parse(await readFile(path.join(stage,'build-inputs.json'),'utf8'))
await writeFile(path.join(stage,'build-result.json'),JSON.stringify({electron:'33.4.11',output:outputs[0],sourceInputs:inputs,checked:true},null,2))
console.log(outputs[0])
