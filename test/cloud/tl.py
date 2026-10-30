import json,sys
n=int(sys.argv[1])
for l in open('runs.jsonl').readlines()[-n:]:
  r=json.loads(l); v=r.get('recv',{}); s=r.get('send',{})
  if 'MBps' not in v: print('==', r.get('label'), 'ERR', (v.get('error') or s.get('error') or r.get('threw',''))[:200]); continue
  print('==',r['label'], round(v['MBps'],1), 'steady', v.get('steadyMBps') and round(v['steadyMBps'],1), 'secs',round(v['secs'],1), 'ok', v['ok'], 'switches', len(s.get('switches') or []), len(v.get('switches') or []))
  print('   tl', v.get('timeline'), [(p['local'].split('/')[2], p['rttMs']) for p in v['pairs'] if p])
  print('   send threads', [(t['name'],t['pct']) for t in s['cpu']['topThreads'][:3]], 'recv drops', v['cpu']['kernel'].get('U:RcvbufErrors'))
