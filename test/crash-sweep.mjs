// node [--env-file=.env.local] crash-sweep.mjs <project> <env|redis://...>: a guard whose function dies while a
// revoke is in flight leaves that credential tracked, no sweep calls revoke again while its claim holds, and the
// first sweep after the claim lapses revokes it. Redis only: a memory store dies with its process.
import { spawn } from 'node:child_process';
import { iceInstance, guardInstance, stub } from './ice-env.mjs';
import { sleep } from './lib.mjs';

const [project, store, role] = process.argv.slice(2);
if (role === 'child') {
  const closed = await guardInstance(project, store, 'child', { RELAY_BUDGET_GB: '0' });
  await closed();
  process.exit(0);
}
const failures = [];
const expect = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); ok || failures.push(what); };

await stub('reset', {});
await stub('usage', { bytes: 100e9 });
const ice = await iceInstance(project, store, `crash-${Date.now()}`, { RELAY_MINTS_PER_HOUR: '100000' });
const users = (await Promise.all([1, 2, 3].map((i) => ice(`192.0.2.${i}`)))).map((r) => r.body.iceServers?.[0].username);
expect(users.every(Boolean), `three credentials minted under budget: ${users.filter(Boolean).length}`);
await stub('fail-revoke', { username: users[1], hangMs: 60_000 });
const watch = await guardInstance(project, store, `watch-${Date.now()}`);
const closed = await guardInstance(project, store, `closed-${Date.now()}`, { RELAY_BUDGET_GB: '0' });

// a guard with a budget of 0 reads the same 100 GB reading as closed and sweeps
const child = spawn(process.execPath, [process.argv[1], project, store, 'child'], { stdio: 'inherit', env: process.env });
let s;
for (const end = Date.now() + 10_000; !(s = await stub('state')).revokes.includes(users[1]) && Date.now() < end; ) await sleep(50);
await sleep(200);
child.kill('SIGKILL');
const calls = (u) => s.revokes.filter((r) => r === u).length;
expect(calls(users[0]) === 1 && calls(users[1]) === 1 && calls(users[2]) === 1, `the dying sweep called revoke once for each: ${users.map(calls).join('')}`);
let r = await watch();
expect(r.body.state === 'open' && r.body.live === 1, `the credential whose revoke was cut short is still tracked: ${JSON.stringify(r.body)}`);
r = await closed();
s = await stub('state');
expect(r.body.state === 'closed' && r.body.revoked === 0 && calls(users[1]) === 1, `a sweep while the claim holds leaves it alone: ${JSON.stringify(r.body)}, ${calls(users[1])} calls`);
await sleep(10_500);
r = await closed();
s = await stub('state');
expect(r.body.revoked === 1 && r.body.live === 0 && calls(users[1]) === 2, `the first sweep after the claim lapses revokes it: ${JSON.stringify(r.body)}, ${calls(users[1])} calls`);
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
