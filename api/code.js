import { createHash } from 'node:crypto';
import { codes } from '../lib/codes.js';
import { storeFromEnv } from '../lib/guard.js';
import { limiter, clientIp } from '../lib/limit.js';

const store = codes();
const over = limiter(storeFromEnv());
// Per client a minute. A sender claims once and renews every few minutes, a receiver looks up once; there are
// only 361 names, so without a limit one address could claim them all or list every live room.
const perMin = (name, fallback) => Number(process.env[name]) || fallback;
const CLAIMS_PER_MIN = perMin('CODE_CLAIMS_PER_MIN', 20);
const FINDS_PER_MIN = perMin('CODE_FINDS_PER_MIN', 30);
const NAME = /^[bcdfghjkmnpqrstvwxz]{2}$/;
const KEY = /^[a-z0-9]{20}$/;
// the room is derived from a key only its sender knows, so only that sender can renew or release it
const roomOf = (key) => createHash('sha256').update(`et-room|${key}`).digest('hex').slice(0, 32);

const reply = (status, body, retry) =>
  new Response(body && JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', ...(body && { 'Content-Type': 'application/json' }), ...(retry && { 'Retry-After': String(retry) }) },
  });

// GET ?name=: the room a code's name leads to
export async function GET(request) {
  const name = new URL(request.url).searchParams.get('name') ?? '';
  if (!NAME.test(name)) return reply(400);
  const retry = await over(clientIp(request), 'code:find', FINDS_PER_MIN, 60);
  if (retry) return reply(429, null, retry);
  const room = await store.find(name);
  return room ? reply(200, { room }) : reply(404);
}

// POST {name, key}: hold name for this sender's room, or renew it. {name, key, end: true} lets it go.
export async function POST(request) {
  const retry = await over(clientIp(request), 'code:claim', CLAIMS_PER_MIN, 60);
  if (retry) return reply(429, null, retry);
  let m;
  try {
    m = await request.json();
  } catch {
    return reply(400);
  }
  if (typeof m?.name !== 'string' || !NAME.test(m.name) || typeof m.key !== 'string' || !KEY.test(m.key)) return reply(400);
  const room = roomOf(m.key);
  if (m.end === true) {
    await store.release(m.name, room);
    return reply(204);
  }
  return (await store.claim(m.name, room)) ? reply(204) : reply(409);
}
