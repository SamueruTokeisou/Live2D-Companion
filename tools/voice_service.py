"""Explicit local voice service controls. No startup items or global configuration changes."""
from pathlib import Path
import argparse, json, os, socket, subprocess, time, urllib.request
from local_state import atomic_json, operation_lock

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / 'runtime/voice/gpt-sovits-v2pro-20250604'
STATE = ROOT / 'data/voice-service.json'


def owned():
    import psutil
    try:
        state = json.loads(STATE.read_text(encoding='utf-8'))
        if not Path(state['python']).resolve().is_relative_to(INSTALL.resolve()): return None
        process = psutil.Process(state['pid'])
        if Path(process.exe()).resolve() != Path(state['python']).resolve() or abs(process.create_time()-state['created']) > 0.01:
            return None
        return process
    except (OSError, ValueError, KeyError, psutil.Error):
        return None


def start():
    import psutil
    if owned():
        print('Voice service is already running.'); return
    try:
        occupied = socket.create_connection(('127.0.0.1',9880),timeout=1)
    except OSError:
        occupied = None
    if occupied:
        occupied.close(); raise RuntimeError('Port 9880 is occupied; refusing to manage an unrelated service')
    receipt = json.loads((INSTALL / 'companion-install.json').read_text(encoding='utf-8'))
    python = INSTALL / receipt['python']; api = INSTALL / receipt['api']; engine = api.parent
    if not python.resolve().is_relative_to(INSTALL.resolve()) or not api.resolve().is_relative_to(INSTALL.resolve()):
        raise ValueError('Installation receipt escapes runtime')
    weights = ['GPT_SoVITS/pretrained_models/s1v3.ckpt', 'GPT_SoVITS/pretrained_models/v2Pro/s2Gv2ProPlus.pth']
    if not all((engine/name).is_file() for name in weights):
        raise FileNotFoundError('Selected v2ProPlus base weights are missing')
    config = ROOT / 'data/voice-reference/tts_infer.yaml'; config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text('custom:\n  device: cuda\n  is_half: true\n  version: v2ProPlus\n  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large\n  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base\n  t2s_weights_path: '+weights[0]+'\n  vits_weights_path: '+weights[1]+'\n', encoding='utf-8')
    env = os.environ.copy(); env['PYTHONIOENCODING'] = 'utf-8'; env['PYTHONUNBUFFERED'] = '1'; env['HF_HOME'] = str(ROOT/'data/voice-cache/huggingface'); env['TORCH_HOME'] = str(ROOT/'data/voice-cache/torch')
    env['PYTHONPATH'] = str(engine/'GPT_SoVITS'); env['version'] = 'v2ProPlus'
    with (config.parent/'service.log').open('ab') as log:
        child = subprocess.Popen([str(python), str(api), '-a', '127.0.0.1', '-p', '9880', '-c', str(config)], cwd=engine, env=env, stdout=log, stderr=log,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    atomic_json(STATE, {'schemaVersion':1, 'pid':child.pid, 'created':psutil.Process(child.pid).create_time(), 'python':str(python)}, backup=False)
    deadline = time.monotonic()+120
    while time.monotonic()<deadline:
        if child.poll() is not None: raise RuntimeError('Voice service failed; inspect private data/voice-reference/service.log')
        try:
            with urllib.request.urlopen('http://127.0.0.1:9880/openapi.json', timeout=1) as response:
                data=json.load(response)
                if '/tts' in data.get('paths',{}): print('Voice service ready on 127.0.0.1:9880.'); return
        except (OSError, ValueError): pass
        time.sleep(0.5)
    child.terminate(); child.wait(timeout=10)
    raise RuntimeError('Voice startup timed out; stopped only the child started by this attempt')


def stop():
    process = owned()
    if process is None: print('No owned voice service is running.'); return
    process.terminate(); process.wait(timeout=10)
    print('Owned voice service stopped; model GPU memory can be released.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['start','stop','status']);args=parser.parse_args()
    with operation_lock(ROOT/'data/voice-operation.lock'):
        if args.action=='start': start()
        elif args.action=='stop': stop()
        else: print('running' if owned() else 'stopped')
