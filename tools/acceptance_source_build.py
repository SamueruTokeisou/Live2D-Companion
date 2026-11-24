"""Observe a locally source-built app with the owner's existing character; no cloud calls."""
from pathlib import Path
import argparse,json,os,subprocess,time
from pet_manager import ROOT,profiles,rpc,alive,stop_all,start
from acceptance_kernel import verify
from local_state import atomic_json,read_config

def run(executable,hold=0):
    executable=Path(executable).resolve()
    if not executable.is_relative_to((ROOT/'runtime/source-build').resolve()) or not executable.is_file(): raise ValueError('Use a local source-build executable')
    original=next(p for p in profiles() if p['id']=='deepseek')
    ident='source-smoke-'+str(time.time_ns());home=ROOT/'data'/ident
    config=read_config(ROOT/'data/deepseek/settings.json');config['updateCheck']=False
    atomic_json(home/'settings.json',config)
    env=os.environ.copy();env.pop('ELECTRON_RUN_AS_NODE',None)
    env.update(STAGE_HOME=str(home),STAGE_COMPANION_AUTH_HOME=str(ROOT/'data/chatgpt-auth'),STAGE_LEGACY_CRYPTO_HOME=str(ROOT/'data/deepseek'),STAGE_MANAGER_FILE=str(ROOT/'tools/pet_manager.py'),STAGE_MANAGER_PYTHON=str(Path(os.sys.executable).with_name('pythonw.exe')),STAGE_VOICE_PYTHON=str(ROOT/'runtime/voice-tools/Scripts/python.exe'),STAGE_VOICE_SCRIPT=str(ROOT/'tools/voice_service.py'))
    profile={**original,'id':ident};child=None
    stop_all()
    try:
        child=subprocess.Popen([str(executable)],cwd=executable.parent,env=env,creationflags=subprocess.CREATE_NO_WINDOW)
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            if child.poll() is not None: raise RuntimeError('Source build exited before ready')
            if alive(profile):
                h=rpc(profile,'local:health')['value']
                if h['frame'] and h['frame']['ticks']>5:break
            time.sleep(.2)
        else:raise RuntimeError('Source build did not render')
        checks=verify(profile)
        auth=rpc(profile,'chat:snapshot');assert auth['ok'] and auth['value']['auth']['signedIn']
        assert rpc(profile,'body:snapshot')['value']['presentation']['mouthSupported']
        if hold:time.sleep(min(hold,30))
        result={'checks':checks,'sourceExecutable':str(executable.relative_to(ROOT)),'rendered':True,'existingLoginReadable':True,'debugging':False,'cloudRequests':0}
        atomic_json(ROOT/'validation/source-build-smoke.json',result)
        print(json.dumps({'checksPassed':len(checks),'rendered':True,'existingLoginReadable':True,'cloudRequests':0}),flush=True)
    finally:
        if child is not None:
            if alive(profile):rpc(profile,'local:quit')
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:child.terminate();child.wait(timeout=10)
        start(original)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('executable');parser.add_argument('--hold',type=int,default=0);args=parser.parse_args();run(args.executable,args.hold)
