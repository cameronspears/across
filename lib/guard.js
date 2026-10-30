import { redisUrl, lazyClient } from './redis.js';
import { relayFromEnv } from './relay.js';
import { limiter } from './limit.js';

const TTL_S = 8 * 3600; // the relay drops a connection soon after its credential expires
const WINDOW_DAYS = 31; // any 31 days stay under budget, however the provider's month is aligned
const FRESH_MS = 60_000; // ask the provider for usage at most once a minute
const BLIND_MS = 5 * 60_000; // after this long with every usage query failing, revoke as if over budget
const LEASE_MS = 10_000; // outlasts one usage query, which times out after 8 seconds
const CLAIM_MS = 10_000; // outlasts one revoke call, which times out after 8 seconds
const WAITS = 15; // waits of 200 ms, about 3 seconds, for another request's usage query
const SWEEP_MS = 5000;
const READING = 'relay:usage';
const LEASE = 'relay:usage-lease';
const DAY_MS = 86_400_000;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// A usage reading is { at, bytes, today, failingSince }: at is when its query started, bytes the last 31 days
// and today that UTC day alone (both null when the query failed), and failingSince is when the current run
// of failed queries began. The relay's budget state is derived from the latest reading:
//   open     under a minute old and under both budgets: mint
//   closed   under a minute old and at or over either budget: refuse, and revoke every live credential
//   unknown  no such reading: refuse, and once queries have failed for BLIND_MS, revoke too
// The daily budget means someone burning relay traffic on purpose costs everyone one day of the relay, not a month.
const stateOf = (reading, now, budget, daily) =>
  !reading || now - reading.at >= FRESH_MS || reading.bytes === null ? 'unknown'
    : reading.bytes < budget && (reading.today ?? 0) < daily ? 'open' : 'closed';
const revokes = (state, reading, now) =>
  state === 'closed' || (state === 'unknown' && reading?.failingSince != null && now - reading.failingSince >= BLIND_MS);

let memory; // without Redis, every guard in the process shares one store, the way function instances share Redis

export function guardFromEnv(env = process.env) {
  return guard({
    relay: relayFromEnv(env),
    store: storeFromEnv(env),
    budgetBytes: amount(env, 'RELAY_BUDGET_GB', 900, 1000) * 1e9, // 1,000 GB a month is Cloudflare's free allowance
    dailyBytes: amount(env, 'RELAY_DAILY_GB', 60, 1000) * 1e9,
    mintsPerHour: amount(env, 'RELAY_MINTS_PER_HOUR', 20),
  });
}

export function storeFromEnv(env = process.env) {
  const url = redisUrl(env);
  return url ? redisStore(url) : (memory ??= memoryStore());
}

function amount(env, name, fallback, max = Infinity) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (raw.trim() && Number.isFinite(n) && n >= 0 && n <= max) return n;
  console.error(`${name} must be a number of at least 0${max < Infinity ? ` and at most ${max}` : ''}, not "${raw}"; using ${fallback}`);
  return fallback;
}

// admit(ip) -> [status, body] answers GET /api/ice. It checks, in order: provider configured, per-client rate,
// budget, then mint. check() -> [status, body] answers GET /api/guard with the same budget check and no mint.
function guard({ relay, store, budgetBytes, dailyBytes, mintsPerHour }) {
  const over = limiter(store);

  // Returns a reading under a minute old, or after WAITS the latest one seen, which counts as unknown.
  // A request that finds no fresh reading either takes the lease and queries, or waits for the
  // lease holder's reading; it never decides on the reading it saw before the wait.
  async function usage() {
    for (let waits = 0; ; waits++) {
      const seen = JSON.parse((await store.get(READING)) ?? 'null');
      if ((seen && Date.now() - seen.at < FRESH_MS) || waits === WAITS) return seen;
      if (await store.put(LEASE, '1', LEASE_MS, true)) return refresh(seen);
      await sleep(200);
    }
  }

  // A failed query is stored too, so it counts as this minute's query and nobody retries it until the next.
  async function refresh(seen) {
    const at = Date.now();
    let bytes = null, today = null;
    try {
      ({ total: bytes, lastDay: today } = await relay.egress(day(at - (WINDOW_DAYS - 1) * DAY_MS), day(at)));
    } catch (err) {
      console.error('relay usage:', err.message);
    }
    const failingSince = bytes !== null ? null : seen?.bytes === null ? seen.failingSince : at;
    const reading = { at, bytes, today, failingSince };
    await store.put(READING, JSON.stringify(reading), TTL_S * 1000);
    return reading;
  }

  // Safe to run any number of times, concurrently too. A sweep claims a credential for CLAIM_MS before
  // revoking it and drops it from the set only once the revoke succeeds, so a revoke that fails, or
  // that dies with its function, is retried by the first sweep after the claim lapses.
  async function sweep() {
    const until = Date.now() + SWEEP_MS;
    const live = await store.live(Date.now());
    let revoked = 0;
    for (let i = 0; i < live.length && Date.now() < until; i += 10) {
      await Promise.all(live.slice(i, i + 10).map(async (username) => {
        if (!(await store.put(`relay:revoking:${username}`, '1', CLAIM_MS, true))) return;
        try {
          await relay.revoke(username);
        } catch (err) {
          return console.error('relay revoke:', err.message);
        }
        await store.untrack(username);
        revoked++;
      }));
    }
    return revoked;
  }

  async function evaluate() {
    const reading = await usage();
    const now = Date.now();
    const state = stateOf(reading, now, budgetBytes, dailyBytes);
    const known = state !== 'unknown';
    return { state, bytes: known ? reading.bytes : null, today: known ? reading.today : null, revoked: revokes(state, reading, now) ? await sweep() : 0 };
  }

  async function admit(ip) {
    if (relay.name === 'none') return [503, { relay: 'off' }];
    const retry = await over(ip, 'relay:rate', mintsPerHour, 3600);
    if (retry) return [429, { relay: 'busy', retry }]; // seconds until the next hour
    if ((await evaluate()).state !== 'open') return [503, { relay: 'budget' }];
    let minted;
    try {
      minted = await relay.mint(TTL_S);
    } catch (err) {
      console.error('relay mint:', err.message);
      return [502, { relay: 'error' }];
    }
    await store.track(minted.username, Date.now() + TTL_S * 1000);
    // the budget may have closed during the mint, after a sweep that couldn't see this credential
    if ((await evaluate()).state !== 'open') return [503, { relay: 'budget' }];
    return [200, { iceServers: minted.iceServers }];
  }

  async function check() {
    if (relay.name === 'none') return [503, { relay: 'off' }];
    const { state, bytes, today, revoked } = await evaluate();
    const live = await store.liveCount(Date.now());
    const gb = (n) => (n === null || n === undefined ? null : n / 1e9);
    return [200, { state, usedGB: gb(bytes), budgetGB: budgetBytes / 1e9, todayGB: gb(today), dailyGB: dailyBytes / 1e9, live, revoked }];
  }

  return { admit, check };
}

// Credentials live in one sorted set scored by expiry, so expired ones prune by score.
function redisStore(url) {
  const redis = lazyClient(url);
  const CREDS = 'relay:creds';
  return {
    get: async (key) => (await redis()).get(key),
    put: async (key, value, ms, onlyIfNew = false) =>
      (await (await redis()).set(key, value, { expiration: { type: 'PX', value: ms }, ...(onlyIfNew && { condition: 'NX' }) })) === 'OK',
    count: async (key, seconds) => Number((await (await redis()).multi().incr(key).expire(key, seconds).exec())[0]),
    async track(username, expires) {
      await (await redis()).multi()
        .zAdd(CREDS, { score: expires, value: username })
        .zRemRangeByScore(CREDS, '-inf', Date.now())
        .expire(CREDS, TTL_S)
        .exec();
    },
    async live(now) {
      const client = await redis();
      await client.zRemRangeByScore(CREDS, '-inf', now);
      return client.zRangeByScore(CREDS, now, '+inf');
    },
    liveCount: async (now) => (await redis()).zCount(CREDS, now, '+inf'),
    untrack: async (username) => (await redis()).zRem(CREDS, username),
  };
}

function memoryStore() {
  const values = new Map(); // key -> { value, expires }
  const creds = new Map(); // username -> expires
  const read = (key) => {
    const v = values.get(key);
    if (v && v.expires > Date.now()) return v.value;
    values.delete(key);
    return null;
  };
  const write = (key, value, ms) => values.set(key, { value, expires: Date.now() + ms });
  return {
    get: async (key) => read(key),
    async put(key, value, ms, onlyIfNew = false) {
      if (onlyIfNew && read(key) !== null) return false;
      write(key, value, ms);
      return true;
    },
    async count(key, seconds) {
      const n = Number(read(key) ?? 0) + 1;
      write(key, String(n), seconds * 1000);
      return n;
    },
    async track(username, expires) {
      creds.set(username, expires);
    },
    async live(now) {
      for (const [username, expires] of creds) if (expires <= now) creds.delete(username);
      return [...creds.keys()];
    },
    liveCount: async (now) => [...creds.values()].filter((expires) => expires > now).length,
    untrack: async (username) => creds.delete(username),
  };
}
