"""Explicit live P3 check; consumes existing Codex account quota (three requests)."""
import argparse
from pathlib import Path
import time
from pet_manager import ROOT, profiles, alive, rpc
from local_state import atomic_json


def verify(profile):
    checks=[]
    def call(op,payload=None):
        result=rpc(profile,op,payload)
        if not result.get('ok'): raise RuntimeError('operation failed: '+op)
        return result.get('value')
    def snapshot(): return call('chat:snapshot')
    def check(name,passed):
        checks.append({'name':name,'pass':bool(passed)})
        if not passed: raise AssertionError(name)
    def wait(predicate,seconds=55):
        end=time.monotonic()+seconds
        while time.monotonic()<end:
            s=snapshot()
            if s['lastError']: raise RuntimeError(s['lastError']['code'])
            if predicate(s): return s
            time.sleep(.04)
        raise TimeoutError('conversation result missing')
    def last_reply(s): return next((e for e in reversed(s['entries']) if e['role']=='assistant'),{})
    try:
        call('chat:enable',{'value':True});call('chat:clear')
        call('chat:send',{'text':'这次测试我给桌宠取的小名是海盐。请用一句简短中文向我问好。'})
        first=wait(lambda s:last_reply(s).get('status')=='completed')
        check('真实中文回应与后端验证',first['verified'] and any('\u4e00'<=c<='\u9fff' for c in last_reply(first)['text']))
        call('chat:send',{'text':'请写一段约250字的中文散文，描写清晨海边，不要分条。'})
        wait(lambda s:last_reply(s).get('status')=='streaming' and bool(last_reply(s).get('text')))
        call('chat:stop')
        stopped=wait(lambda s:last_reply(s).get('status')=='cancelled',seconds=6)
        captured=last_reply(stopped).get('text')
        time.sleep(1.2)
        check('真实流式请求停止且没有迟到正文',last_reply(snapshot()).get('text')==captured and not call('body:snapshot')['textVisible'])
        call('chat:send',{'text':'我在刚才第一轮给桌宠取的小名是什么？只回答小名。'})
        final=wait(lambda s:last_reply(s).get('status')=='completed')
        check('多轮上下文与停止后恢复', '海盐' in last_reply(final)['text'])
        check('可取得的用量被记录且金额未知',final['usage']['knownInputTokens']>0 and final['usage']['knownOutputTokens']>0 and final['usage']['amount'] is None)
        check('限制清晰且没有自动重试',final['limits']['callsPerRound']==1 and final['limits']['timeoutSeconds']==45 and final['limits']['maxOutputChars']==500)
        h=call('local:health')
        check('正常模式桌宠仍出帧且无故障',not h['debugging'] and h['frame']['ticks']>0 and h['faultCount']==0)
        log=ROOT/'data'/profile['id']/'logs/kernel-events.jsonl'
        check('事件日志没有测试正文','小名是海盐' not in log.read_text(encoding='utf-8'))
        report={'checks':checks,'model':final['model'],'usage':final['usage'],'note':'实际云端回归，原始聊天只留内存；此报告只含统计。'}
    finally:
        rpc(profile,'chat:stop');rpc(profile,'chat:clear');rpc(profile,'chat:enable',{'value':False})
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--live',action='store_true',help='明确运行真实请求，会使用现有Codex账号额度')
    parser.add_argument('--output',type=Path,default=ROOT/'validation/p3-live.json')
    args=parser.parse_args()
    if not args.live: parser.error('真实验收需 --live；不运行时不会调用模型')
    running=[p for p in profiles() if alive(p)]
    if len(running)!=1: parser.error('请先正常启动一个角色')
    report=verify(running[0]);atomic_json(args.output,report)
    print('P3 live checks:',len(report['checks']),'passed; usage is recorded, amount unknown.')
