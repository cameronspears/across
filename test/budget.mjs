// node [--env-file=.env.local] budget.mjs <project> <memory|env|redis://...>: the budget guard through /api/ice and
// /api/guard against the Cloudflare stub, on a store with no usage reading and no credentials yet (empty-store.mjs).
// Two instances of each function share the store, like Vercel function instances. Over three usage windows:
// under budget it reads usage once per window however many requests arrive; when usage crosses the budget no
// request mints, every live credential is revoked exactly once, and a failed revoke is retried after its claim;
// with usage unreadable it refuses and revokes nothing, until queries have failed for 5 minutes.
import { iceInstance, guardInstance, stub } from './ice-env.mjs';
import { sleep } from './lib.mjs';

const [project, store] = process.argv.slice(2);
const failures = [];
const expect = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); ok || failures.push(what); };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const ip = (i) => `198.51.100.${i}`;
const GB = 1e9, CLAIM_MS = 10_000, LEASE_MS = 10_000, BLIND_MS = 5 * 60_000;
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;

let redis = null;
if (store !== 'memory') {
  const { createClient } = await import(`${project}/node_modules/redis/dist/index.js`);
  redis = await createClient({ url: store === 'env' ? process.env.REDIS_URL : store, disableClientInfo: true }).connect();
  const leftover = await redis.exists(['relay:usage', 'relay:usage-lease', 'relay:creds']);
  expect(leftover === 0, `store starts with no usage reading, lease, or credentials: ${leftover} of those keys present`);
}
const local = store.startsWith('redis://127.0.0.1');
async function commands(fn) {
  await redis.configResetStat();
  const result = await fn();
  const stats = (await redis.info('commandstats')).split('\r\n').map((l) => l.match(/^cmdstat_(\w+):calls=(\d+)/)).filter(Boolean)
    .filter(([, cmd]) => cmd !== 'config' && cmd !== 'info').map(([, cmd, n]) => [cmd, Number(n)]);
  return { result, total: stats.reduce((n, [, c]) => n + c, 0), detail: stats.map(([c, n]) => `${c}=${n}`).join(' ') };
}

await stub('reset', {});
await stub('usage', { bytes: 100 * GB });
const fast = { RELAY_MINTS_PER_HOUR: '100000' };
const [a, b] = [await iceInstance(project, store, `a-${realNow()}`, fast), await iceInstance(project, store, `b-${realNow()}`, fast)];
const [g, h] = [await guardInstance(project, store, `g-${realNow()}`), await guardInstance(project, store, `h-${realNow()}`)];
const ice = (n, from) => Promise.all(Array.from({ length: n }, (_, i) => (i % 2 ? a : b)(ip(from + i))));
const guard = (n) => Promise.all(Array.from({ length: n }, (_, i) => (i % 2 ? g : h)()));
const same = (x, y) => JSON.stringify(x, Object.keys(x).sort()) === JSON.stringify(y, Object.keys(y).sort());
const answers = (replies) => JSON.stringify([...new Set(replies.map((r) => `${r.status} ${JSON.stringify(r.body)}`))]);
const reports = (replies, want) => replies.every((r) => r.status === 200 && r.cache === 'no-store' && same({ ...r.body, revoked: 0 }, { ...want, revoked: 0 }));
const revokedBy = (replies) => replies.reduce((n, r) => n + r.body.revoked, 0);

let replies = await guard(20);
let s = await stub('state');
const t0 = s.usageQueries[0]?.at ?? realNow();
expect(s.usageQueries.length === 1, `20 concurrent guard calls on an empty store make one usage query: ${s.usageQueries.length}`);
expect(replies.every((r) => Object.keys(r.body).sort().join() === 'budgetGB,live,revoked,state,usedGB'), `guard answers exactly state, usedGB, budgetGB, live, revoked: ${Object.keys(replies[0].body)}`);
expect(reports(replies, { state: 'open', usedGB: 100, budgetGB: 900, live: 0 }) && revokedBy(replies) === 0, `every guard call reports open at 100 of 900 GB, nothing live, nothing revoked: ${answers(replies)}`);
const q = s.usageQueries[0]?.variables;
expect(q?.account === 'test-account' && q.to === day(realNow()) && q.from === day(realNow() - 30 * 86_400_000),
  `usage query covers the last 31 UTC days for the account: ${JSON.stringify(q)}`);
expect(s.usageQueries[0]?.dataset && !s.usageQueries[0]?.keyFilter, 'query reads callsTurnUsageAdaptiveGroups for every key on the account');

replies = await ice(20, 0);
s = await stub('state');
expect(replies.every((r) => r.status === 200 && r.body.iceServers?.length && r.cache === 'no-store'), `20 concurrent requests under budget all mint: ${[...new Set(replies.map((r) => r.status))]}`);
expect(s.usageQueries.length === 1, `20 concurrent mints on the guard's fresh reading make no usage query: ${s.usageQueries.length - 1}`);
const handedOut = replies.map((r) => r.body.iceServers[0].username);
expect(s.mints.length === 20 && handedOut.every((u) => s.mints.some((m) => m.username === u && m.ttl === 8 * 3600)), `20 credentials minted with an 8 hour TTL: ${s.mints.length}`);
expect(replies.every((r) => r.body.iceServers.every((x) => x.urls.every((u) => /^turns?:/.test(u) && !/:53\b/.test(u)))), 'no STUN and no port 53 URLs handed out');
replies = await ice(10, 100);
s = await stub('state');
expect(replies.every((r) => r.status === 200) && s.usageQueries.length === 1, `10 more within the minute mint without a new usage query: ${s.usageQueries.length - 1}`);
const live = s.mints.map((m) => m.username);

const cost = local ? await commands(() => g()) : { result: await g() };
s = await stub('state');
expect(reports([cost.result], { state: 'open', usedGB: 100, budgetGB: 900, live: 30 }) && cost.result.body.revoked === 0, `guard on a fresh reading reports 30 live: ${answers([cost.result])}`);
expect(s.usageQueries.length === 1 && s.mints.length === 30 && s.revokes.length === 0, 'guard on a fresh reading makes no Cloudflare call');
if (local) expect(cost.total <= 3, `guard on a fresh reading costs ${cost.total} Redis commands: ${cost.detail}`);

await stub('usage', { bytes: 900 * GB });
await stub('fail-revoke', { username: live[3] });
for (const u of live.slice(4, 9)) await stub('fail-revoke', { username: u, times: 1e9 });
await sleep(Math.max(0, t0 + 61_000 - realNow()));
replies = await ice(10, 200);
s = await stub('state');
const calls = (u) => s.revokes.filter((r) => r === u).length;
expect(replies.every((r) => r.status === 503 && r.body.relay === 'budget'), `at budget every request gets 503 budget: ${answers(replies)}`);
expect(s.usageQueries.length === 2, `one new usage query after the minute, for 10 concurrent requests: ${s.usageQueries.length - 1}`);
expect(s.mints.length === 30, `nothing minted at budget: ${s.mints.length - 30} extra`);
expect(live.every((u, i) => (i >= 3 && i < 9) || calls(u) === 1), `each of the 24 healthy credentials revoked exactly once: ${live.map(calls).join('')}`);
expect(live.slice(3, 9).every((u) => calls(u) === 1), `each credential whose revoke fails was tried once: ${live.slice(3, 9).map(calls).join('')}`);
expect(s.revokes.every((u) => live.includes(u)), `nothing revoked that was not handed out: ${s.revokes.filter((u) => !live.includes(u)).length}`);

await sleep(CLAIM_MS + 500);
replies = await guard(20);
s = await stub('state');
expect(reports(replies, { state: 'closed', usedGB: 900, budgetGB: 900, live: 5 }), `every guard call reports closed at 900 of 900 GB with 5 live: ${answers(replies)}`);
expect(revokedBy(replies) === 1 && calls(live[3]) === 2, `20 concurrent guard calls retry the revoke that failed once and report 1 revoked between them: ${revokedBy(replies)} reported, ${calls(live[3])} calls`);
expect(live.slice(4, 9).every((u) => calls(u) === 2), `each revoke that still fails is retried exactly once: ${live.slice(4, 9).map(calls).join('')}`);
expect(s.usageQueries.length === 2, `no usage query while the closed reading is fresh: ${s.usageQueries.length - 2}`);
const settled = s.revokes.length;
replies = (await Promise.all([guard(5), ice(5, 220)])).flat();
s = await stub('state');
expect(replies.every((r) => (r.body.state ? r.body.revoked === 0 : r.status === 503)) && s.revokes.length === settled && s.mints.length === 30,
  `calling again inside the claim is a no-op: ${s.revokes.length - settled} revoke calls, ${s.mints.length - 30} mints`);

await stub('graphql-error', { on: true });
await sleep(Math.max(0, t0 + 122_000 - realNow()));
const quiet = s.revokes.length;
replies = await guard(20);
s = await stub('state');
expect(s.usageQueries.length === 3, `20 concurrent guard calls make one usage query when it fails: ${s.usageQueries.length - 2}`);
expect(reports(replies, { state: 'unknown', usedGB: null, budgetGB: 900, live: 5 }) && revokedBy(replies) === 0, `with the usage query failing every guard call reports unknown: ${answers(replies)}`);
expect(s.revokes.length === quiet, `unknown after one failed query revokes nothing: ${s.revokes.length - quiet} revoke calls`);
replies = await ice(5, 240);
s = await stub('state');
expect(replies.every((r) => r.status === 503 && r.body.relay === 'budget') && s.mints.length === 30 && s.usageQueries.length === 3,
  `with no usage reading, refuse and mint nothing, and leave the failed query until the next minute: ${answers(replies)}`);

for (const u of live.slice(4, 9)) await stub('fail-revoke', { username: u, times: 0 });
await sleep(LEASE_MS + 500);
skew = BLIND_MS;
replies = await guard(20);
s = await stub('state');
expect(s.usageQueries.length === 4, `5 minutes later, one more failed usage query: ${s.usageQueries.length - 3}`);
expect(reports(replies, { state: 'unknown', usedGB: null, budgetGB: 900, live: 0 }), `still unknown: ${answers(replies)}`);
expect(revokedBy(replies) === 5 && live.slice(4, 9).every((u) => calls(u) === 3),
  `after 5 minutes of failed usage queries the guard revokes every live credential once: ${revokedBy(replies)} reported, ${live.slice(4, 9).map(calls).join('')} calls`);
const done = s.revokes.length;
replies = await guard(5);
s = await stub('state');
expect(replies.every((r) => r.body.revoked === 0 && r.body.live === 0) && s.revokes.length === done, `re-running once nothing is live is a no-op: ${s.revokes.length - done} revoke calls`);
await stub('graphql-error', { on: false });
skew = 0;

if (redis) {
  await redis.del(['relay:usage', 'relay:usage-lease']); // the last reading carries the skewed clock
  await redis.quit();
}
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
