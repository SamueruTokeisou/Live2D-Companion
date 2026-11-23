"""Normal-mode P2 acceptance. Uses fixed local fixtures; leaves kernel disabled."""
import argparse
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from pet_manager import ROOT, profiles, alive, rpc
from local_state import atomic_json


def verify(profile):
    checks = []
    def check(name, passed):
        checks.append({'name': name, 'pass': bool(passed)})
        if not passed: raise AssertionError(name)
    def call(op, payload=None):
        result = rpc(profile, op, payload)
        if not result.get('ok'): raise RuntimeError('Acceptance operation failed: ' + op)
        return result.get('value')
    def snapshot(): return call('kernel:snapshot')
    def wait(predicate, timeout=5):
        deadline = time.monotonic()+timeout
        while time.monotonic()<deadline:
            state=snapshot()
            if predicate(state): return state
            time.sleep(.04)
        raise AssertionError('State did not arrive before deadline')
    def send(text):
        state=call('kernel:event', {'type':'text','text':text})
        return next(r['eventId'] for r in reversed(state['records']) if r['type']=='text' and r['status']=='queued')
    try:
        call('kernel:enable', {'value':True});call('kernel:cancel');call('kernel:pause',{'value':False});call('kernel:quiet',{'value':False})
        check('明确为本地规则且无 AI',snapshot()['mode']=='local-test' and not snapshot()['aiConnected'])
        capabilities=call('kernel:capabilities')
        check('能力声明与首期身体一致',{'text','stop'}.issubset(capabilities['commands']) and not capabilities['gaze'] and not capabilities['gestures'])
        old=send('acceptance-private-fixture-old')
        first=wait(lambda s:s['state']=='responding')
        check('文字进入响应且身体显示',call('body:snapshot')['textVisible'])
        body=call('body:snapshot')
        try:
            call('body:execute',{'kind':'gesture'})
            check('HTTP禁止直接身体执行',False)
        except HTTPError as error:
            check('HTTP禁止直接身体执行',error.code==403)
        new=send('acceptance-private-fixture-new')
        newer=wait(lambda s:s['state']=='responding' and s['active']['eventId']==new)
        check('新输入取消旧任务',any(r['eventId']==old and r['status']=='cancelled' for r in newer['records']))
        call('kernel:cancel');wait(lambda s:s['active'] is None)
        deadline=time.monotonic()+2
        while call('body:snapshot')['textVisible'] and time.monotonic()<deadline: time.sleep(.04)
        time.sleep(2.1)
        check('停止清理身体且旧文字不再返回',not call('body:snapshot')['textVisible'] and call('body:snapshot')['closed'])
        call('kernel:pause',{'value':True})
        for _ in range(5): call('kernel:event',{'type':'click'})
        batched=snapshot()
        check('连续点击合并排队',len(batched['queue'])==1 and batched['queue'][0]['count']==5)
        call('kernel:quiet',{'value':True});check('免打扰清空整批背景事件',not snapshot()['queue'])
        call('kernel:event',{'type':'click'});check('免打扰抑制点击',snapshot()['records'][-1]['status']=='suppressed')
        allowed=send('acceptance-private-fixture-paused');time.sleep(.2)
        check('暂停保留用户文字且不执行',snapshot()['state']=='paused' and len(snapshot()['queue'])==1)
        call('kernel:pause',{'value':False})
        wait(lambda s:any(r['eventId']==allowed and r['status']=='completed' for r in s['records']))
        check('继续后处理保留输入',snapshot()['state']=='idle')
        call('kernel:quiet',{'value':False});timerState=call('kernel:timer',{'ms':200});timer=timerState['timers'][-1]
        wait(lambda s:any(r['eventId']==timer and r['status']=='completed' for r in s['records']))
        check('实际计时事件完成',True)
        health=call('local:health')
        check('正常模式无调试端口且舞台无故障',not health['debugging'] and health['faultCount']==0)
        path=ROOT/'data'/profile['id']/'logs/kernel-events.jsonl'
        check('事件日志不含输入内容','acceptance-private-fixture' not in path.read_text(encoding='utf-8'))
    finally:
        rpc(profile,'kernel:enable',{'value':False})
    check('结束后内核关闭无残留任务',not snapshot()['enabled'] and not snapshot()['active'] and not snapshot()['queue'] and not snapshot()['timers'])
    return checks


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--profile')
    parser.add_argument('--output',type=Path,default=ROOT/'validation/p2-live.json')
    args=parser.parse_args()
    running=[p for p in profiles() if alive(p) and (not args.profile or p['id']==args.profile)]
    if len(running)!=1: parser.error('请先正常启动且只选择一个桌宠')
    checks=verify(running[0])
    atomic_json(args.output,{'checks':checks,'note':'接口回归，不替代真实窗口观察。'})
    print(json.dumps(checks,ensure_ascii=False,indent=2))
