import { redisUrl, lazyClient } from './redis.js';

const TTL_S = 600;

// Short codes. The first letters of a code name a room; the rest never reach the server.
// claim(name, room) holds name for room, or renews it; false if another room has it.
// find(name) is the room or null. release(name, room) frees it if room holds it.
export function codes(url = redisUrl()) {
  return url ? redisCodes(url) : memoryCodes();
}

function redisCodes(url) {
  const client = lazyClient(url);
  const key = (name) => `code:${name}`;
  return {
    async claim(name, room) {
      const c = await client();
      if (await c.set(key(name), room, { NX: true, EX: TTL_S })) return true;
      if ((await c.get(key(name))) !== room) return false;
      await c.expire(key(name), TTL_S);
      return true;
    },
    async find(name) {
      return (await client()).get(key(name));
    },
    async release(name, room) {
      const c = await client();
      if ((await c.get(key(name))) === room) await c.del(key(name));
    },
  };
}

function memoryCodes() {
  const held = new Map(); // name -> { room, expires: ms }
  const find = (name) => {
    const h = held.get(name);
    if (h && h.expires > Date.now()) return h.room;
    held.delete(name);
    return null;
  };
  return {
    async claim(name, room) {
      const now = find(name);
      if (now && now !== room) return false;
      held.set(name, { room, expires: Date.now() + TTL_S * 1000 });
      return true;
    },
    find: async (name) => find(name),
    async release(name, room) {
      if (find(name) === room) held.delete(name);
    },
  };
}
