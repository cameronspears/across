import { createHash, randomBytes } from 'node:crypto';

const DAY_MS = 86_400_000;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Vercel overwrites both headers with the address the request came from.
export const clientIp = (request) =>
  request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '';

// An IPv6 client usually holds a whole /64 and can pick any address in it, so the /64 is the client.
export function clientOf(ip) {
  const v4 = ip.match(/^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4 || !ip.includes(':')) return v4?.[1] ?? ip;
  const [head, tail = ''] = ip.toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

// Fixed-window counters per client, on a store with get, put(key, value, ms, onlyIfNew) and count(key, seconds).
// Keys hold a salted hash of the client, never its address; the salt changes daily.
export function limiter(store) {
  let salt; // [day, secret]

  async function client(ip) {
    const today = day(Date.now());
    if (salt?.[0] !== today) {
      await store.put(`relay:salt:${today}`, randomBytes(32).toString('hex'), 2 * DAY_MS, true);
      salt = [today, await store.get(`relay:salt:${today}`)];
    }
    return createHash('sha256').update(`${salt[1]}|${clientOf(ip)}`).digest('hex');
  }

  // over(ip, name, max, seconds) -> 0 while this is one of the first max calls in the window, else seconds until it ends
  return async function over(ip, name, max, seconds) {
    const window = Math.floor(Date.now() / 1000 / seconds);
    if ((await store.count(`${name}:${window}:${await client(ip)}`, seconds)) <= max) return 0;
    return (window + 1) * seconds - Math.floor(Date.now() / 1000);
  };
}
