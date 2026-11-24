"""Pinned upstream provenance. Optional original snapshot stays private under runtime/."""
from pathlib import Path
import argparse,hashlib,json,subprocess,zipfile,stat
ROOT=Path(__file__).resolve().parents[1]
SOURCE='source/desktop-v1.1.0/'
SHA256='dbcd141bcaf41a20dd95fd4af4ce649338f777cf6563105fa117cfb66f85b8b1'
MANIFEST=ROOT/'upstream/fulaska-v1.1.0.json'
def tracked():
 return [s[len(SOURCE):] for s in subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0') if s.startswith(SOURCE)]
def digest(data):return hashlib.sha256(data).hexdigest()
def normalized(data):return data.replace(b'\r\n',b'\n')
def generate(archive):
 archive=Path(archive)
 if digest(archive.read_bytes())!=SHA256:raise ValueError('Upstream archive checksum mismatch')
 files={}
 with zipfile.ZipFile(archive) as z:
  names=set(z.namelist())
  for rel in tracked():
   current=(ROOT/SOURCE/rel).read_bytes()
   if rel in names:
    original=z.read(rel);same=normalized(current)==normalized(original)
    files[rel]={'kind':'upstream-unchanged' if same else 'upstream-modified','sha256':digest(original),'normalizedSha256':digest(normalized(original))}
   else:files[rel]={'kind':'companion-integration'}
 MANIFEST.parent.mkdir(exist_ok=True)
 MANIFEST.write_text(json.dumps({'archive':'https://github.com/FULASKA/-live2d-/releases/download/v1.1.0/live2d-stage-src-v1.1.0.zip','sha256':SHA256,'license':'MIT','files':files},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def check():
 manifest=json.loads(MANIFEST.read_text(encoding='utf-8'))
 if manifest['sha256']!=SHA256 or set(manifest['files'])!=set(tracked()):raise ValueError('Source inventory changed; regenerate from the pinned archive')
 for rel,entry in manifest['files'].items():
  if entry['kind']=='upstream-unchanged' and digest(normalized((ROOT/SOURCE/rel).read_bytes()))!=entry['normalizedSha256']:raise ValueError('Previously unchanged upstream file modified: '+rel)
 print('Upstream provenance verified:',len(manifest['files']),'engine files')
def materialize(archive):
 archive=Path(archive)
 if digest(archive.read_bytes())!=SHA256:raise ValueError('Upstream archive checksum mismatch')
 out=ROOT/'runtime/upstream/fulaska-v1.1.0'
 if out.exists():raise ValueError('Snapshot already exists; never overwrite it')
 manifest=json.loads(MANIFEST.read_text(encoding='utf-8'))
 with zipfile.ZipFile(archive) as z:
  for rel,entry in manifest['files'].items():
   if 'sha256' not in entry:continue
   target=(out/rel).resolve()
   if not target.is_relative_to(out.resolve()):raise ValueError('Snapshot path escape')
   data=z.read(rel)
   if digest(data)!=entry['sha256']:raise ValueError('Upstream file mismatch')
   target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);target.chmod(stat.S_IREAD)
 print('Read-only upstream snapshot prepared under runtime/upstream')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--archive',type=Path);p.add_argument('--generate',action='store_true');p.add_argument('--materialize',action='store_true');a=p.parse_args()
 if a.generate:generate(a.archive)
 check()
 if a.materialize:materialize(a.archive)
