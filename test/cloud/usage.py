import json
tx=0; n=0
for l in open('runs.jsonl'):
  r=json.loads(l)
  for s in ('send','recv'):
    c=(r.get(s) or {}).get('cpu')
    if c: tx+=c['txMB']
  n+=1
print(f'runs {n}, measured tx during timed regions {tx/1000:.2f} GB')
