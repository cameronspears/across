import { mailbox } from '../lib/mailbox.js';
import { storeFromEnv } from '../lib/guard.js';
import { limiter, clientIp, crossSite } from '../lib/limit.js';

const store = mailbox();
const over = limiter(storeFromEnv());
// Per client a minute. A connecting page makes about 10 posts and 10 polls in its first minute and then polls
// about twice a minute, so these leave room for an office or mobile carrier sharing one address. They stop one
// address filling Redis or holding hundreds of its connections; many addresses need the Vercel firewall too.
const perMin = (name, fallback) => Number(process.env[name]) || fallback;
const POSTS_PER_MIN = perMin('SIGNAL_POSTS_PER_MIN', 180);
const POLLS_PER_MIN = perMin('SIGNAL_POLLS_PER_MIN', 180);
const WAIT_S = 25;
const MAX_BODY = 8192; // a real offer with both descriptions is about 1.1 KB
const ROOM = /^[0-9a-f]{32}$/;
const RID = /^[a-z0-9]{16}$/;
const roleOf = (id) => (id === 's' ? 's' : RID.test(id) ? 'r' : null);

const KINDS = new Map([
  ['hello', { from: 'r', to: 's', sdp: false }],
  ['offer', { from: 's', to: 'r', sdp: true }],
  ['answer', { from: 'r', to: 's', sdp: true }],
]);

const reply = (status, body, retry) =>
  new Response(body && JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', ...(body && { 'Content-Type': 'application/json' }), ...(retry && { 'Retry-After': String(retry) }) },
  });

const exactly = (o, keys) =>
  typeof o === 'object' && o !== null && !Array.isArray(o) && Object.keys(o).sort().join() === keys;

function parse(bytes) {
  if (bytes.byteLength > MAX_BODY) return null;
  let m;
  try {
    m = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!exactly(m, 'data,from,room,to') || typeof m.room !== 'string' || !ROOM.test(m.room)) return null;
  const kind = KINDS.get(m.data?.t);
  if (!kind || roleOf(m.from) !== kind.from || roleOf(m.to) !== kind.to) return null;
  if (!kind.sdp) return exactly(m.data, 't') ? { ...m, data: { t: m.data.t } } : null;
  // lan: an optional second description for a link over the local network
  const desc = (d) => exactly(d, 'sdp,type') && d.type === m.data.t && typeof d.sdp === 'string' && d.sdp.startsWith('v=0\r\n');
  const { sdp, lan } = m.data;
  const ok = (exactly(m.data, 'sdp,t') || (exactly(m.data, 'lan,sdp,t') && desc(lan))) && desc(sdp);
  if (!ok) return null;
  const data = { t: m.data.t, sdp: { type: sdp.type, sdp: sdp.sdp } };
  if (lan) data.lan = { type: lan.type, sdp: lan.sdp };
  return { ...m, data };
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const room = q.get('room') ?? '', me = q.get('me') ?? '';
  if (crossSite(request)) return reply(403);
  if (!ROOM.test(room) || !roleOf(me)) return reply(400);
  const retry = await over(clientIp(request), 'signal:poll', POLLS_PER_MIN, 60);
  if (retry) return reply(429, null, retry);
  return reply(200, await store.take(`m:${room}:${me}`, WAIT_S, request.signal));
}

export async function POST(request) {
  if (crossSite(request)) return reply(403);
  if (Number(request.headers.get('content-length')) > MAX_BODY) return reply(400);
  const retry = await over(clientIp(request), 'signal:post', POSTS_PER_MIN, 60);
  if (retry) return reply(429, null, retry);
  const m = parse(await request.arrayBuffer());
  if (!m) return reply(400);
  await store.push(`m:${m.room}:${m.to}`, { from: m.from, data: m.data });
  return reply(204);
}
