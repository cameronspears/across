// node api.mjs <baseUrl>: /api/signal rejects every malformed request and long-polls correctly.
import crypto from 'node:crypto';

const base = process.argv[2];
const url = new URL('api/signal', base).href;
const room = () => crypto.randomBytes(16).toString('hex');
const R = 'abcdefghijkmnpqr', SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
const post = (body) => fetch(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const get = (room, me) => fetch(`${url}?room=${room}&me=${me}`);
let failures = 0;
const check = (name, ok, detail = '') => { failures += !ok; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && ` (${detail})`}`); };

const rm = room();
const hello = { room: rm, from: R, to: 's', data: { t: 'hello' } };
const offer = { room: rm, from: 's', to: R, data: { t: 'offer', sdp: { type: 'offer', sdp: SDP } } };
const bad = {
  'room too short': { ...hello, room: 'abc' },
  'room uppercase': { ...hello, room: rm.toUpperCase() },
  'room not a string': { ...hello, room: 7 },
  'from bad id': { ...hello, from: 'ABCDEFGHIJKLMNOP' },
  'to bad id': { ...offer, to: 'x' },
  'unknown t': { ...hello, data: { t: 'ice' } },
  't is __proto__': { ...hello, data: { t: '__proto__' } },
  'hello to a receiver': { ...hello, from: 's', to: R },
  'offer from a receiver': { ...offer, from: R, to: 's' },
  'answer to a receiver': { ...offer, data: { t: 'answer', sdp: { type: 'answer', sdp: SDP } } },
  'sdp type mismatch': { ...offer, data: { t: 'offer', sdp: { type: 'answer', sdp: SDP } } },
  'sdp not a string': { ...offer, data: { t: 'offer', sdp: { type: 'offer', sdp: 5 } } },
  'sdp not sdp': { ...offer, data: { t: 'offer', sdp: { type: 'offer', sdp: '<script>' } } },
  'extra top-level key': { ...hello, x: 1 },
  'extra data key': { ...hello, data: { t: 'hello', x: 1 } },
  'missing data': { room: rm, from: R, to: 's' },
  'array body': [hello],
  'oversized body': { ...offer, data: { t: 'offer', sdp: { type: 'offer', sdp: SDP + 'a=x\r\n'.repeat(1700) } } },
  'not json': '{"room":',
};
for (const [name, body] of Object.entries(bad)) {
  const r = await post(body);
  check(`POST ${name} -> 400`, r.status === 400, r.status);
}
for (const [name, q] of Object.entries({ 'bad room': ['xyz', 's'], 'bad me': [rm, 'S'], 'missing me': [rm, ''] })) {
  const r = await get(...q);
  check(`GET ${name} -> 400`, r.status === 400, r.status);
}
const big = JSON.stringify(bad['oversized body']).length;
check('oversized body really is over 8KB', big > 8192, `${big}B`);

check('POST hello -> 204', (await post(hello)).status === 204);
check('POST offer -> 204', (await post(offer)).status === 204);
let r = await get(rm, 's');
check('GET returns the hello as an envelope', JSON.stringify(await r.json()) === JSON.stringify([{ from: R, data: { t: 'hello' } }]));
check('GET is no-store', r.headers.get('cache-control') === 'no-store', r.headers.get('cache-control'));
r = await get(rm, R);
check('receiver gets the offer', (await r.json())[0]?.data?.sdp?.sdp === SDP);

const flood = room();
for (let i = 0; i < 40; i++) await post({ room: flood, from: 's', to: R, data: { t: 'offer', sdp: { type: 'offer', sdp: `${SDP}a=n:${i}\r\n` } } });
const kept = (await (await get(flood, R)).json()).map((e) => Number(e.data.sdp.sdp.match(/a=n:(\d+)/)[1]));
check('mailbox keeps the newest 32, in order', kept.length === 32 && kept[0] === 8 && kept[31] === 39, `${kept.length} kept, ${kept[0]}..${kept.at(-1)}`);

const late = room();
const waiting = get(late, 's').then((r) => r.json());
await new Promise((ok) => setTimeout(ok, 1000));
const tPush = Date.now();
await post({ ...hello, room: late });
const woke = await waiting;
check('a waiting GET returns as soon as a message arrives', woke.length === 1 && Date.now() - tPush < 1000, `${Date.now() - tPush}ms`);

const t0 = Date.now();
r = await get(room(), 's');
const body = await r.text(), secs = (Date.now() - t0) / 1000;
check('GET with no messages returns [] after ~25s', r.status === 200 && body === '[]' && secs >= 24.5 && secs < 27, `${body} after ${secs.toFixed(1)}s`);
process.exit(failures ? 1 : 0);
