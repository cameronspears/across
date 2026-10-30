// node hardening.mjs: the API refuses calls a page on another site makes from its visitors' browsers, /api/guard takes
// no query and lets the CDN answer repeats, one client can take only CODE_NEW_PER_10_MIN new code names (renewals
// are free), and a client over a limit costs no store calls until its window ends. In memory, no server needed.
import crypto from 'node:crypto';
import { limiter } from '../lib/limit.js';

process.env.CODE_NEW_PER_10_MIN = '3';
const signal = await import('../api/signal.js');
const code = await import('../api/code.js');
const ice = await import('../api/ice.js');
const guard = await import('../api/guard.js');

const failures = [];
const expect = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); ok || failures.push(what); };
let n = 0;
const ip = () => `198.51.100.${++n}`;
const req = (path, { site, from = ip(), ...init } = {}) =>
  new Request(`https://x${path}`, { ...init, headers: { 'x-real-ip': from, ...(site && { 'sec-fetch-site': site }), ...init.headers } });
const room = crypto.randomBytes(16).toString('hex');
const hello = JSON.stringify({ room, from: 'abcdefgh12345678', to: 's', data: { t: 'hello' } });

for (const site of ['cross-site', 'same-site']) {
  const codes = [
    (await signal.POST(req('/api/signal', { site, method: 'POST', body: hello }))).status,
    (await signal.GET(req(`/api/signal?room=${room}&me=s`, { site }))).status,
    (await code.GET(req('/api/code?name=bb', { site }))).status,
    (await code.POST(req('/api/code', { site, method: 'POST', body: '{}' }))).status,
    (await ice.GET(req('/api/ice', { site }))).status,
  ];
  expect(codes.every((s) => s === 403), `Sec-Fetch-Site: ${site} -> 403 on every endpoint: ${codes}`);
}
expect((await signal.POST(req('/api/signal', { site: 'same-origin', method: 'POST', body: hello }))).status === 204, 'same-origin post -> 204');
expect((await signal.POST(req('/api/signal', { method: 'POST', body: hello }))).status === 204, 'no Sec-Fetch-Site (a script) -> 204');
const big = await signal.POST(req('/api/signal', { method: 'POST', body: 'x'.repeat(9000), headers: { 'content-length': '9000' } }));
expect(big.status === 400, `9000-byte post -> 400: ${big.status}`);

const g = await guard.GET(req('/api/guard'));
expect(g.headers.get('vercel-cdn-cache-control') === 'max-age=20' && g.headers.get('cache-control') === 'no-store', `guard: CDN caches 20 s, browsers don't: ${g.headers.get('vercel-cdn-cache-control')}`);
expect((await guard.GET(req('/api/guard?bust=1'))).status === 400, 'guard with a query -> 400');

const from = ip(), key = (i) => `key${String(i).padStart(17, '0')}`;
const claim = (name, i) => code.POST(req('/api/code', { from, method: 'POST', body: JSON.stringify({ name, key: key(i) }) }));
const firstThree = [(await claim('bc', 1)).status, (await claim('bd', 2)).status, (await claim('bf', 3)).status];
expect(firstThree.every((s) => s === 204), `three new names -> 204: ${firstThree}`);
const fourth = await claim('bg', 4);
expect(fourth.status === 429 && Number(fourth.headers.get('retry-after')) > 0, `a fourth new name -> 429, Retry-After ${fourth.headers.get('retry-after')}`);
expect((await claim('bc', 1)).status === 204, 'renewing a held name still -> 204');
expect((await code.POST(req('/api/code', { method: 'POST', body: JSON.stringify({ name: 'bg', key: key(4) }) }))).status === 204, 'another client can still take a name');

let calls = 0;
const store = new Map();
const over = limiter({
  get: async (k) => store.get(k) ?? null,
  put: async (k, v, ms, onlyIfNew) => (onlyIfNew && store.has(k) ? false : (store.set(k, v), true)),
  count: async (k) => (++calls, store.set(k, (store.get(k) ?? 0) + 1), store.get(k)),
});
const seen = [];
for (let i = 0; i < 10; i++) seen.push(await over('203.0.113.9', 't', 3, 60));
expect(seen.slice(0, 3).every((r) => r === 0) && seen.slice(3).every((r) => r > 0), `limiter: 3 allowed, then refused: ${seen}`);
expect(calls === 4, `limiter: refusals after the first cost no store calls: ${calls} counts for 10 calls`);
expect((await over('203.0.113.10', 't', 3, 60)) === 0, 'limiter: another client is unaffected');

console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
