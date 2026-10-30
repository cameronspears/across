import { createHash, randomBytes } from 'node:crypto';

const DAY_MS = 86_400_000;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Vercel overwrites both headers with the address the request came from.
export const clientIp = (request) =>
  request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '';

// A page on another site can make its visitors' browsers call the API, spreading one attacker over many
// addresses. Browsers say so in Sec-Fetch-Site; scripts can lie, but then they need addresses of their own.
export const crossSite = (request) => /^(cross|same)-site$/.test(request.headers.get('sec-fetch-site') ?? '');

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
// A client over a limit is remembered in memory until its window ends, so flooding a warm instance costs no Redis.
export function limiter(store) {
  let salt; // [day, secret]
  const blocked = new Map(); // `${name}|${client}` -> ms when its window ends

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
    const who = await client(ip), held = blocked.get(`${name}|${who}`);
    if (held > Date.now()) return Math.ceil((held - Date.now()) / 1000);
    const window = Math.floor(Date.now() / 1000 / seconds);
    if ((await store.count(`${name}:${window}:${who}`, seconds)) <= max) return 0;
    if (blocked.size >= 10_000) blocked.clear();
    blocked.set(`${name}|${who}`, (window + 1) * seconds * 1000);
    return (window + 1) * seconds - Math.floor(Date.now() / 1000);
  };
}
