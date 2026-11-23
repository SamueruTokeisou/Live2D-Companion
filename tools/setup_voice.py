"""Install the fixed official GPT-SoVITS Windows package locally; never starts a service."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import shutil
import subprocess
import os
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'c8b61d4f627d1f02e74c1ba158a4844051d2289f'
PACKAGE = 'GPT-SoVITS-v2pro-20250604.7z'
SHA256 = 'bd60d0796553ff05d8568136e199c13e0dc22ebe2ed24273134e34ed6f215cd6'
URL = f'https://huggingface.co/lj1995/GPT-SoVITS-windows-package/resolve/{REVISION}/{PACKAGE}'


def safe_members(names):
    for name in names:
        p = PurePosixPath(name.replace('\\', '/'))
        if p.is_absolute() or '..' in p.parts or any(':' in part for part in p.parts):
            raise ValueError('Archive path escapes installation directory')


def install(root=ROOT):
    import py7zr
    root = Path(root).resolve()
    target = root / 'runtime/voice/gpt-sovits-v2pro-20250604'
    archive = root / 'downloads' / PACKAGE
    receipt = target / 'companion-install.json'
    if receipt.exists():
        data = json.loads(receipt.read_text(encoding='utf-8'))
        if data.get('sha256') == SHA256 and (target / data['api']).is_file():
            print('Voice engine already installed; no service started.', flush=True)
            return
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        partial = archive.with_suffix('.download')
        offset = partial.stat().st_size if partial.exists() else 0
        request = urllib.request.Request(URL, headers={'User-Agent': 'Live2D-Companion', **({'Range': f'bytes={offset}-'} if offset else {})})
        with urllib.request.urlopen(request, timeout=90) as response:
            resume = offset and response.status == 206
            if resume and not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                raise ValueError('Unexpected resume range')
            total = int(response.headers.get('Content-Length', 0)) + (offset if resume else 0)
            if shutil.disk_usage(root).free < 35 * 2**30:
                raise ValueError('Need at least 35 GiB free for download and extraction')
            done = offset if resume else 0
            next_report = done
            with partial.open('ab' if resume else 'wb') as out:
                while block := response.read(4 * 2**20):
                    out.write(block); done += len(block)
                    if done >= next_report:
                        print(f'Download {done / 2**30:.2f}/{total / 2**30:.2f} GiB', flush=True)
                        next_report = done + 256 * 2**20
        partial.replace(archive)
    with archive.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    if digest != SHA256:
        raise ValueError('Voice package checksum mismatch; do not execute')
    target.mkdir(parents=True, exist_ok=True)
    print('Checksum verified. Extracting locally...', flush=True)
    with py7zr.SevenZipFile(archive) as bundle:
        safe_members(bundle.getnames())
        for entry in bundle.list():
            if getattr(entry, 'is_symlink', False):
                raise ValueError('Archive symlinks are not accepted')
        native = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / '7-Zip/7z.exe'
        if not native.is_file():
            bundle.extractall(target)
        else:
            subprocess.run([str(native), 'x', str(archive), '-o' + str(target), '-aoa', '-y', '-bso0', '-bsp0'], check=True)
    apis = list(target.rglob('api_v2.py'))
    if len(apis) != 1:
        raise ValueError('Cannot identify a unique official API entry point')
    engine = apis[0].parent
    python = engine / 'runtime/python.exe'
    if not python.is_file():
        raise ValueError('Packaged Python is missing')
    receipt.write_text(json.dumps({'schemaVersion': 1, 'upstream': URL, 'revision': REVISION, 'sha256': SHA256,
                                   'api': str(apis[0].relative_to(target)), 'python': str(python.relative_to(target)),
                                   'referenceReady': False, 'serviceStarted': False}, indent=2), encoding='utf-8')
    print('Installed isolated official engine. Reference voice is still required. No service started.', flush=True)


if __name__ == '__main__':
    install()
