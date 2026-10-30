import { createHash } from 'node:crypto';
import { codes } from '../lib/codes.js';

const store = codes();
const NAME = /^[bcdfghjkmnpqrstvwxz]{2}$/;
const KEY = /^[a-z0-9]{20}$/;
// the room is derived from a key only its sender knows, so only that sender can renew or release it
const roomOf = (key) => createHash('sha256').update(`et-room|${key}`).digest('hex').slice(0, 32);

const reply = (status, body) =>
  new Response(body && JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', ...(body && { 'Content-Type': 'application/json' }) },
  });

// GET ?name=: the room a code's name leads to
export async function GET(request) {
  const name = new URL(request.url).searchParams.get('name') ?? '';
  if (!NAME.test(name)) return reply(400);
  const room = await store.find(name);
  return room ? reply(200, { room }) : reply(404);
}

// POST {name, key}: hold name for this sender's room, or renew it. {name, key, end: true} lets it go.
export async function POST(request) {
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
