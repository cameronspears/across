# python3 summary.py: per label, receiver MB/s over the whole transfer (median, range), the runs that
# failed or never finished, stall time (0.5 s intervals under 1 MB/s after the first), and sender CPU.
import json, statistics
from collections import defaultdict

rows = defaultdict(list)
for line in open('runs.jsonl'):
    r = json.loads(line)
    rows[r.get('label')].append(r)

def stall_s(tl):
    return sum(0.5 for x in (tl or [])[1:-1] if x < 1)

print(f"{'label':14} {'n':>2} {'ok':>2} {'median':>7} {'min':>6} {'max':>6} {'stall_s':>12} {'sendThread%max':>15} relay protocols")
for label, rs in rows.items():
    good = [r for r in rs if r.get('recv', {}).get('MBps') and (r.get('ok') or r.get('recv', {}).get('ok'))]
    v = sorted(r['recv']['MBps'] for r in good)
    stalls = [stall_s(r['recv'].get('timeline')) for r in good if 'timeline' in r['recv']]
    th = [max([t['pct'] for t in r['send']['cpu']['topThreads']] or [0]) for r in good if r['send'].get('cpu')]
    protos = sorted({(p or {}).get('local', '?').split('/')[2] for r in good for p in (r['recv'].get('pairs') or r['recv'].get('links') or [])})
    if not v:
        print(f"{label:14} {len(rs):>2} {0:>2}  all failed")
        continue
    print(f"{label:14} {len(rs):>2} {len(good):>2} {statistics.median(v):7.1f} {v[0]:6.1f} {v[-1]:6.1f} {str(stalls):>12} {max(th) if th else 0:15.0f} {','.join(protos)}")
