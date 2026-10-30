// node daily.mjs <project>: a day's relay traffic at RELAY_DAILY_GB (default 60) closes the relay, whatever the
// 31-day total. Each case runs in its own process, since the in-memory usage reading is shared and lasts a minute.
import { execFileSync } from 'node:child_process';
import { iceInstance, guardInstance, stub } from './ice-env.mjs';

const [project, today, raw] = process.argv.slice(2);
const GB = 1e9;
if (today === undefined) {
  let failed = 0;
  for (const [t, r] of [[59, ''], [60, ''], [5, '5'], [5, '6']]) {
    try { process.stdout.write(execFileSync('node', [process.argv[1], project, String(t), r])); } catch (e) { process.stdout.write(e.stdout); failed++; }
  }
  console.log(failed ? `FAIL (${failed})` : 'PASS');
  process.exit(failed ? 1 : 0);
}
const extra = raw ? { RELAY_DAILY_GB: raw } : {};
const want = Number(today) < Number(raw || 60) ? 'open' : 'closed';
await stub('reset', {});
await stub('usage', { bytes: 100 * GB, today: Number(today) * GB });
const g = await guardInstance(project, 'memory', 'g', extra);
const ice = await iceInstance(project, 'memory', 'i', extra);
const { body } = await g();
const minted = (await ice('203.0.113.9')).status;
const ok = body.state === want && body.todayGB === Number(today) && body.dailyGB === Number(raw || 60) && minted === (want === 'open' ? 200 : 503);
console.log(`${ok ? 'PASS' : 'FAIL'} ${today} GB today, RELAY_DAILY_GB=${raw || 'default 60'} -> ${body.state}, ice ${minted}`);
process.exit(ok ? 0 : 1);
