"""Allowlisted health sampling, without raw logs, tokens, model names or paths."""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import time
from pet_manager import ROOT, profiles, alive, rpc
from local_state import atomic_json


def summarize(samples, requested, elapsed):
    valid = [s['health'] for s in samples if 'health' in s]
    memory = [sum(p['workingSetKiB'] for p in h['processes']) / 1024 for h in valid]
    cpu = [sum(p['cpu'] for p in h['processes']) for h in valid]
    gaps = [b['elapsedSeconds']-a['elapsedSeconds'] for a,b in zip(samples,samples[1:])]
    stalls = sum(1 for a,b in zip(valid,valid[1:]) if a.get('visible') and b.get('visible') and a.get('frame') and b.get('frame') and not b['frame'].get('halted') and not b['frame'].get('paused') and b['uptimeSeconds'] > a['uptimeSeconds'] and a['frame']['ticks'] == b['frame']['ticks'])
    restarts = sum(1 for a,b in zip(valid,valid[1:]) if b['uptimeSeconds'] < a['uptimeSeconds'] or [p['pid'] for p in a['processes'] if p['type']=='Browser'] != [p['pid'] for p in b['processes'] if p['type']=='Browser'])
    return {'schemaVersion': 1, 'requestedSeconds': requested, 'elapsedSeconds': round(elapsed, 2),
            'samples': len(samples), 'healthSamples': len(valid), 'failedSamples': len(samples)-len(valid),
            'memoryMiB': {'first': memory[0], 'last': memory[-1], 'min': min(memory), 'max': max(memory)} if memory else None,
            'electronReportedCpuSum': {'min': min(cpu), 'max': max(cpu)} if cpu else None,
            'durationReached': elapsed >= requested, 'maxSampleGapSeconds': round(max(gaps, default=0),2), 'visibleStallIntervals': stalls, 'runtimeRestarts': restarts, 'lastHealth': valid[-1] if valid else None,
            'note': '资源与帧循环采样不等于人工互动、GPU画面或休眠恢复验收。'}


def sample(seconds, interval, output):
    running = [p for p in profiles() if alive(p)]
    if len(running) != 1: raise RuntimeError('请先正常启动一个角色，再运行采样')
    profile = running[0]
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    samples = []
    with (output / 'samples.jsonl').open('x', encoding='utf-8') as log:
        while True:
            record = {'at': datetime.now(timezone.utc).isoformat(), 'elapsedSeconds': round(time.monotonic()-start, 2)}
            try:
                result = rpc(profile, 'local:health', timeout=4)
                if not result.get('ok'): raise RuntimeError('health-unavailable')
                record['health'] = result['value']
            except Exception:
                record['error'] = 'health-unavailable'  # No exception paths or credentials in reports.
            samples.append(record)
            log.write(json.dumps(record, ensure_ascii=False)+'\n'); log.flush()
            elapsed = time.monotonic()-start
            atomic_json(output / 'summary.json', summarize(samples, seconds, elapsed))
            if elapsed >= 1800 and not (output / 'checkpoint-30min.json').exists():
                atomic_json(output / 'checkpoint-30min.json', summarize(samples, 1800, elapsed))
            if elapsed >= seconds: break
            time.sleep(min(interval, seconds-elapsed))
    return summarize(samples, seconds, time.monotonic()-start)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--seconds', type=float, default=1800)
    parser.add_argument('--interval', type=float, default=15)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not all(math.isfinite(v) and v > 0 for v in (args.seconds, args.interval)): parser.error('采样时长和间隔必须大于零')
    output = args.output or ROOT / 'validation' / ('p1-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    print(json.dumps(sample(args.seconds, args.interval, output), ensure_ascii=False, indent=2))
