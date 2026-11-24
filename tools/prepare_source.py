"""Compose an isolated, model-free app from tracked source and a local licensed Core."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, time
ROOT=Path(__file__).resolve().parents[1]
def prepare(core, output=None):
    core=Path(core).resolve()
    if not core.is_file(): raise FileNotFoundError('Provide a locally licensed Cubism Core file')
    output=Path(output or ROOT/'runtime/source-build'/str(time.time_ns())).resolve()
    if not output.is_relative_to((ROOT/'runtime/source-build').resolve()) or output.exists(): raise ValueError('Use a new directory under runtime/source-build')
    files=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
    inputs={}
    for name in filter(None,files):
        rel=Path(name)
        if name.startswith('companion/'):
            target=output/rel
        elif name.startswith('source/desktop-v1.1.0/'):
            tail=rel.relative_to('source/desktop-v1.1.0')
            if tail.parts[0] not in {'app','src','extensions'} and str(tail) not in {'package.json','package-lock.json','LICENSE'}: continue
            target=output/tail
        else: continue
        data=(ROOT/rel).read_bytes();inputs[name]=hashlib.sha256(data).hexdigest()
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    (output/'vendor').mkdir();shutil.copy2(core,output/'vendor/live2dcubismcore.min.js')
    package=json.loads((output/'package.json').read_text(encoding='utf-8'));package.update(name='live2d-companion',version='0.4.8-dev',scripts={})
    (output/'package.json').write_text(json.dumps(package,indent=2),encoding='utf-8')
    lock=json.loads((output/'package-lock.json').read_text(encoding='utf-8'));lock.update(name=package['name'],version=package['version']);lock['packages'][''].update(name=package['name'],version=package['version'])
    (output/'package-lock.json').write_text(json.dumps(lock,indent=2),encoding='utf-8')
    from PIL import Image,ImageDraw
    assets=output/'assets';assets.mkdir();icon=Image.new('RGBA',(32,32));ImageDraw.Draw(icon).ellipse((3,3,29,29),fill='#2582b5');icon.save(assets/'app-icon.png');icon.save(assets/'app.ico')
    (output/'build-inputs.json').write_text(json.dumps({'schemaVersion':1,'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT).decode().strip(),'inputs':inputs,'coreSha256':hashlib.sha256(core.read_bytes()).hexdigest(),'modelsIncluded':False,'nativeBetaIncluded':False},indent=2),encoding='utf-8')
    return output
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--core',type=Path,required=True);parser.add_argument('--output',type=Path);args=parser.parse_args();print(prepare(args.core,args.output))
