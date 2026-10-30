// Loads api/ice.js and api/guard.js the way Vercel runs them: env read at import, one module instance per
// function instance. store is 'memory', 'env' (REDIS_URL already set, e.g. by --env-file), or a redis:// URL.
// STUB_URL picks the Cloudflare stub, so separate runs can each have their own.
export const STUB = process.env.STUB_URL ?? 'http://127.0.0.1:8099';

async function instance(project, fn, store, name, extra) {
  Object.assign(process.env, {
    TURN_KEY_ID: 'test-key-id', TURN_KEY_API_TOKEN: 'test-turn-token', CF_ACCOUNT_ID: 'test-account',
    CF_ANALYTICS_TOKEN: 'test-analytics-token', CF_RTC_BASE: STUB, CF_API_BASE: STUB, ...extra,
  });
  if (store === 'memory') { delete process.env.REDIS_URL; delete process.env.KV_URL; }
  else if (store !== 'env') process.env.REDIS_URL = store;
  const mod = await import(`${project}/api/${fn}.js?instance=${name}`);
  for (const k of Object.keys(extra)) delete process.env[k];
  return mod;
}

const answer = async (r) => ({ status: r.status, cache: r.headers.get('cache-control'), body: await r.json() });

export async function iceInstance(project, store, name, extra = {}) {
  const mod = await instance(project, 'ice', store, name, extra);
  return (ip) => mod.GET(new Request('https://x/api/ice', { headers: { 'x-real-ip': ip } })).then(answer);
}

export async function guardInstance(project, store, name, extra = {}) {
  const mod = await instance(project, 'guard', store, name, extra);
  return () => mod.GET(new Request('https://x/api/guard')).then(answer);
}

export const stub = async (path, value) => (await fetch(`${STUB}/stub/${path}`, value === undefined ? {} : { method: 'POST', body: JSON.stringify(value) })).json();
