import { createClient } from 'redis';

// The Redis URL, or null to keep state in memory on a local machine.
export function redisUrl(env = process.env) {
  const url = env.REDIS_URL || env.KV_URL;
  if (!url && (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview')) {
    // function instances don't share memory, so state would vanish at random
    throw new Error('No REDIS_URL or KV_URL. Add Upstash Redis to the project from the Vercel Marketplace.');
  }
  return url || null;
}

export const connect = (url, options) =>
  createClient({ url, disableClientInfo: true, ...options })
    .on('error', (err) => console.error('redis:', err.message))
    .connect();

// One shared connection for non-blocking commands, opened on first use.
export function lazyClient(url) {
  let client;
  return () =>
    (client ??= connect(url).catch((err) => {
      client = undefined;
      throw err;
    }));
}
