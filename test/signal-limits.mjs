// node signal-limits.mjs <project>: /api/signal allows SIGNAL_POSTS_PER_MIN (180) posts and SIGNAL_POLLS_PER_MIN (180) polls a minute per client (an IPv6 /64
// counts as one), then answers 429 with Retry-After, before touching the mailbox. Other clients are unaffected.
import crypto from 'node:crypto';

const [project] = process.argv.slice(2);
delete process.env.REDIS_URL;
delete process.env.KV_URL;
const { GET, POST } = await import(`${project}/api/signal.js?instance=${Date.now()}`);
const failures = [];
const expect = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); ok || failures.push(what); };
const room = () => crypto.randomBytes(16).toString('hex');
const post = (ip, rm = room()) => POST(new Request('https://x/api/signal', {
  method: 'POST', headers: { 'x-real-ip': ip },
  body: JSON.stringify({ room: rm, from: 'abcdefghijkmnpqr', to: 's', data: { t: 'hello' } }),
}));
// each poll's room already holds a message, posted from an address nobody polls from, so it answers at once
let seeder = 0;
const poll = async (ip) => {
  const rm = room();
  await post(`192.0.2.${Math.floor(seeder++ / 150)}`, rm);
  return GET(new Request(`https://x/api/signal?room=${rm}&me=s`, { headers: { 'x-real-ip': ip } }));
};
const run = async (fn, ip, n) => { const out = []; for (let i = 0; i < n; i++) out.push(await fn(ip)); return out; };

// start early in a minute so both windows' counts land in one window
const into = Date.now() % 60_000;
if (into > 45_000) await new Promise((ok) => setTimeout(ok, 61_000 - into));

let r = await run(post, '198.51.100.7', 181);
expect(r.slice(0, 180).every((x) => x.status === 204), `first 180 posts accepted: ${[...new Set(r.slice(0, 180).map((x) => x.status))]}`);
const retry = Number(r[180].headers.get('retry-after'));
expect(r[180].status === 429 && retry > 0 && retry <= 60, `181st post -> ${r[180].status}, Retry-After ${retry}`);
expect((await post('198.51.100.8')).status === 204, 'another client can still post');

r = await run(poll, '2001:db8:1:2::1', 180);
expect(r.every((x) => x.status === 200), `first 180 polls answered: ${[...new Set(r.map((x) => x.status))]}`);
expect((await poll('2001:db8:1:2:ffff::9')).status === 429, 'a 181st poll from another address in the same /64 -> 429');
expect((await poll('2001:db8:1:3::1')).status === 200, 'a different /64 can still poll');

console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
