from pathlib import Path
import json, struct, argparse, hashlib
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description='Read-only Live2D asset audit')
p.add_argument('--model',type=Path,default=ROOT/'DeepSeek免费公皮/DeepSeek/大肥鱼.model3.json')
p.add_argument('--out',type=Path,default=ROOT/'docs/model-audit.json')
a=p.parse_args(); model=a.model.resolve(); base=model.parent
obj=json.loads(model.read_text(encoding='utf-8-sig')); refs=obj['FileReferences']; files=[]
def inspect(rel):
 path=(base/rel).resolve()
 if not path.is_relative_to(base):raise ValueError('Reference escapes model directory: '+rel)
 item={'path':rel,'exists':path.is_file()}
 if path.is_file():
  item['bytes']=path.stat().st_size
  if path.suffix.lower()=='.png':
   with path.open('rb') as f: header=f.read(24)
   if header[:8]==b'\x89PNG\r\n\x1a\n':
    w,h=struct.unpack('>II',header[16:24]);item.update(width=w,height=h,rgba_mib=round(w*h*4/1048576,2))
 files.append(item)
for key in ['Moc','Physics','DisplayInfo','Pose','UserData']:
 if refs.get(key):inspect(refs[key])
for rel in refs.get('Textures',[]):inspect(rel)
expressions=sorted(base.rglob('*.exp3.json'));motions=sorted(base.rglob('*.motion3.json'))
for path in expressions+motions:
 json.loads(path.read_text(encoding='utf-8-sig'))
cdi=json.loads((base/refs['DisplayInfo']).read_text(encoding='utf-8-sig')) if refs.get('DisplayInfo') else {}
report={'model':str(model),'model_sha256':hashlib.sha256(model.read_bytes()).hexdigest(),'references':files,'missing':[i['path'] for i in files if not i['exists']],'expressions':[str(x.relative_to(base)) for x in expressions],'motions':[str(x.relative_to(base)) for x in motions],'registered_expressions':refs.get('Expressions',[]),'registered_motions':refs.get('Motions',{}),'groups':obj.get('Groups',[]),'parameters':cdi.get('Parameters',[]),'rgba_texture_mib':round(sum(x.get('rgba_mib',0) for x in files),2),'limitations':'Static audit only; rendering, moc3 compatibility, interaction and parameter ranges are not verified.'}
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:report[k] for k in ['missing','rgba_texture_mib']},ensure_ascii=False));print('Expressions:',len(expressions),'Motions:',len(motions),'Parameters:',len(report['parameters']));print('Report:',a.out)
raise SystemExit(1 if report['missing'] else 0)
