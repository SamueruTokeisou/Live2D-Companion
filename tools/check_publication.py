"""Check tracked content before publishing. Prints locations, never matching secrets."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BLOCKED_ROOTS = {'models', 'profiles', 'data', 'runtime', 'downloads', 'research', 'validation', 'DeepSeek免费公皮', '.venv'}
BLOCKED_SUFFIXES = {'.moc3', '.psd', '.dll', '.node', '.exe', '.lnk', '.wav', '.mp3', '.png', '.ico', '.zip', '.7z', '.pth', '.ckpt', '.safetensors', '.onnx', '.ogg', '.flac', '.jpg', '.jpeg', '.webp'}
PATTERNS = [r'ghp_[A-Za-z0-9]{20,}', r'github_pat_[A-Za-z0-9_]{30,}',
            r'sk-[A-Za-z0-9_-]{24,}', r'https://[^/\s]+:[^/\s]+@',
            r'C:[\\/]+Users[\\/]+tokei(?:[\\/]|\b)']

def private_machine_path(line):
    users = re.findall(r"[A-Z]:[\\/]+Users[\\/]+([^\\/\s'\"<>]+)", line, re.I)
    return any(user.casefold() not in {'x', 'user', 'username', 'public', 'default', 'example'} for user in users)

def check():
    raw = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT)
    files = [Path(x) for x in raw.decode('utf-8').split('\0') if x]
    problems = []
    for rel in files:
        if rel.parts[0] in BLOCKED_ROOTS or rel.suffix.lower() in BLOCKED_SUFFIXES or rel.name.lower() == 'live2dcubismcore.min.js' or rel.name.lower().endswith(('.model3.json', '.motion3.json', '.physics3.json', '.exp3.json')):
            problems.append((str(rel), 'excluded asset or local state')); continue
        data = (ROOT / rel).read_bytes()
        if b'\0' in data: problems.append((str(rel), 'unexpected binary')); continue
        try: content = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            # Upstream Windows .cmd files use GBK; inspect decoded text as well.
            content = data.decode('gb18030', errors='replace')
        for line_no, line in enumerate(content.splitlines(), 1):
            if private_machine_path(line) or any(re.search(p, line, re.I) for p in PATTERNS):
                problems.append((f'{rel}:{line_no}', 'possible secret or private machine path'))
    for where, kind in problems: print(where, kind)
    print(f'Publication check: {len(files)} files, {len(problems)} findings')
    return not problems

if __name__ == '__main__': raise SystemExit(0 if check() else 1)
