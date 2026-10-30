import json,sys
n=int(sys.argv[1]) if len(sys.argv)>1 else 2
for line in open('runs.jsonl').readlines()[-n:]:
  r=json.loads(line)
  print('==', r.get('label'), r.get('recv',{}).get('MBps'), r.get('ok', r.get('recv',{}).get('ok')), r.get('threw',''))
  for s in ('send','recv'):
    x=r.get(s,{});
    if x.get('error'): print(s,'ERROR',x['error'][:300])
    c=x.get('cpu')
    l=(x.get('links') or x.get('pairs') or [None])
    if c: print(' ',s, 'secs',c['secs'],'machine',c['machinePct'],'tx',round(c['txMB'],1),'rx',round(c['rxMB'],1),c.get('kernel'),[(t['kind'][:12],t['name'],t['pct']) for t in c['topThreads'][:5]], [p and p['local'] for p in l])
