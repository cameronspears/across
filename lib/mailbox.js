import { redisUrl, connect, lazyClient } from './redis.js';

const KEEP = 32;
const TTL_S = 600;

// One list per recipient. push(key, envelope) appends; take(key, seconds, signal)
// waits up to `seconds` for the first envelope, then returns all queued ones.
export function mailbox(url = redisUrl()) {
  return url ? redisMailbox(url) : memoryMailbox();
}

function redisMailbox(url) {
  const pusher = lazyClient(url);
  return {
    async push(key, envelope) {
      const client = await pusher();
      await client.multi().rPush(key, JSON.stringify(envelope)).lTrim(key, -KEEP, -1).expire(key, TTL_S).exec();
    },
    async take(key, seconds, signal) {
      // BLPOP holds its connection, so every wait gets its own
      const client = await connect(url, { socket: { reconnectStrategy: false } });
      const hangUp = () => client.destroy();
      signal?.addEventListener('abort', hangUp);
      try {
        const first = await client.blPop(key, seconds);
        if (!first) return [];
        const rest = (await client.lPopCount(key, KEEP)) ?? [];
        return [first.element, ...rest].map((s) => JSON.parse(s));
      } catch (err) {
        // the requester hung up, so destroy() cut the BLPOP short; nobody is waiting for the answer
        if (signal?.aborted) return [];
        throw err;
      } finally {
        signal?.removeEventListener('abort', hangUp);
        client.destroy();
      }
    },
  };
}

function memoryMailbox() {
  const lists = new Map(); // key -> { items: string[], expires: ms }
  const waiters = new Map(); // key -> Set of wake functions, oldest first, like BLPOP
  const live = (key) => {
    const list = lists.get(key);
    if (list && list.expires > Date.now()) return list;
    lists.delete(key);
  };
  return {
    async push(key, envelope) {
      const items = [...(live(key)?.items ?? []), JSON.stringify(envelope)].slice(-KEEP);
      lists.set(key, { items, expires: Date.now() + TTL_S * 1000 });
      const [wake] = waiters.get(key) ?? [];
      wake?.();
    },
    async take(key, seconds, signal) {
      if (!live(key)) {
        await new Promise((resolve) => {
          const queue = waiters.get(key) ?? new Set();
          const wake = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', wake);
            queue.delete(wake);
            if (!queue.size) waiters.delete(key);
            resolve();
          };
          const timer = setTimeout(wake, seconds * 1000);
          signal?.addEventListener('abort', wake);
          queue.add(wake);
          waiters.set(key, queue);
        });
      }
      const list = signal?.aborted ? undefined : live(key);
      if (!list) return [];
      lists.delete(key);
      return list.items.map((s) => JSON.parse(s));
    },
  };
}
