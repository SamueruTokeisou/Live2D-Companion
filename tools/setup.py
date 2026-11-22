"""Fetch a verified upstream runtime locally, then apply this project's source changes."""
from pathlib import Path
import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://github.com/FULASKA/-live2d-/releases/download/v1.1.0/dafeiyu-live2d-pet-v1.1.0-win32-x64.zip'
SHA256 = '42f2e876c78c67f374c2fb9bbdad6566b4e84860630a62585bb8e4e4558d1e30'
RUNTIME = ROOT / 'runtime/desktop-v1.1.0/大肥鱼Live2d桌宠-发布版-win32-x64'
PATCHES = ['app/placement.mjs', 'app/persistence.mjs', 'app/main.mjs', 'app/renderer.js', 'app/generic.js', 'app/settings.html',
           'app/settings.js', 'app/preload.cjs', 'src/server/stage-server.mjs']

def extract_checked(archive, destination):
    destination = Path(destination).resolve()
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            target = (destination / member.filename).resolve()
            if not target.is_relative_to(destination):
                raise ValueError('Archive path escapes destination')
        z.extractall(destination)

def install(root=ROOT):
    root = Path(root).resolve()
    runtime = root / RUNTIME.relative_to(ROOT)
    archive = root / 'downloads/desktop-v1.1.0.zip'
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        print('Downloading official upstream runtime (about 151 MiB)...')
        partial = archive.with_suffix('.download')
        req = urllib.request.Request(URL, headers={'User-Agent': 'Live2D-Companion-Setup'})
        with urllib.request.urlopen(req, timeout=90) as response, partial.open('wb') as out:
            shutil.copyfileobj(response, out)
        partial.replace(archive)
    with archive.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    if digest != SHA256: raise ValueError('Runtime checksum mismatch; do not run this download')
    if not (runtime / '大肥鱼Live2d桌宠.exe').exists():
        extract_checked(archive, root / 'runtime/desktop-v1.1.0')
    for relative in PATCHES:
        source = root / 'source/desktop-v1.1.0' / relative
        target = runtime / 'resources/app' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for directory in ['models', 'profiles', 'data']:
        (root / directory).mkdir(exist_ok=True)
    (root / 'data/install.json').write_text(json.dumps({
        'upstream': URL, 'sha256': SHA256, 'localVersion': '0.2.0-dev',
        'python': sys.version.split()[0]
    }, indent=2), encoding='utf-8')
    print('Installed. Use Start.cmd to open the role manager; import your own model.')

if __name__ == '__main__':
    install()
