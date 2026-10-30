import { createHmac, randomBytes } from 'node:crypto';

// A relay provider hands out TURN credentials. Every provider has the same shape:
//   mint(ttlSeconds) -> { iceServers, username }   TURN entries only, ready for RTCPeerConnection
//   revoke(username)                                 ends a credential early; resolves once it is gone
//   egress(fromDay, toDay) -> { total, lastDay }     billable bytes over those UTC days inclusive, and on toDay alone
const PROVIDERS = {
  cloudflare: { needs: ['TURN_KEY_ID', 'TURN_KEY_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_ANALYTICS_TOKEN'], make: cloudflare },
  coturn: { needs: ['TURN_SECRET', 'TURN_URL'], make: coturn },
  none: { needs: [], make: () => ({ name: 'none' }) },
};

export function relayFromEnv(env = process.env) {
  const name = env.RELAY || (env.TURN_KEY_ID ? 'cloudflare' : 'none');
  const provider = Object.hasOwn(PROVIDERS, name) && PROVIDERS[name];
  const missing = provider ? provider.needs.filter((k) => !env[k]) : [];
  if (!provider || missing.length) {
    console.error(provider ? `relay ${name} is off: set ${missing.join(', ')}` : `relay is off: RELAY=${name} is not a provider`);
    return PROVIDERS.none.make();
  }
  return provider.make(env);
}

const timeout = () => AbortSignal.timeout(8000);

function cloudflare(env) {
  const keys = `${env.CF_RTC_BASE || 'https://rtc.live.cloudflare.com'}/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials`;
  const graphql = `${env.CF_API_BASE || 'https://api.cloudflare.com'}/client/v4/graphql`;
  const turnAuth = { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}` };
  return {
    name: 'cloudflare',
    async mint(ttl) {
      const r = await fetch(`${keys}/generate-ice-servers`, {
        method: 'POST',
        headers: { ...turnAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl }),
        signal: timeout(),
      });
      if (r.status !== 201) throw new Error(`Cloudflare generate-ice-servers: HTTP ${r.status}`);
      return turnOnly((await r.json())?.iceServers);
    },
    async revoke(username) {
      const r = await fetch(`${keys}/${encodeURIComponent(username)}/revoke`, { method: 'POST', headers: turnAuth, signal: timeout() });
      // 404: already expired or revoked, which is the state we want
      if (!r.ok && r.status !== 404) throw new Error(`Cloudflare revoke: HTTP ${r.status}`);
    },
    // Every TURN key on the account counts: the free allowance is per account, not per key.
    async egress(fromDay, toDay) {
      const r = await fetch(graphql, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query ($account: string!, $from: Date!, $to: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    total: callsTurnUsageAdaptiveGroups(filter: { date_geq: $from, date_leq: $to }, limit: 1) { sum { egressBytes } }
    lastDay: callsTurnUsageAdaptiveGroups(filter: { date_geq: $to, date_leq: $to }, limit: 1) { sum { egressBytes } }
  } }
}`,
          variables: { account: env.CF_ACCOUNT_ID, from: fromDay, to: toDay },
        }),
        signal: timeout(),
      });
      const body = r.ok ? await r.json() : null;
      const account = body?.data?.viewer?.accounts?.[0];
      if (!account || body.errors?.length) {
        throw new Error(`Cloudflare usage query: ${body?.errors?.[0]?.message ?? `HTTP ${r.status}`}`);
      }
      const bytes = (groups) => {
        const n = Number(groups?.[0]?.sum?.egressBytes ?? 0);
        if (!Number.isFinite(n) || n < 0) throw new Error('Cloudflare usage query: egressBytes is not a byte count');
        return n;
      };
      return { total: bytes(account.total), lastDay: bytes(account.lastDay) };
    },
  };
}

// Self-hosted coturn with use-auth-secret. Its credentials can't be revoked, only left to expire,
// and the operator's own server has no allowance to guard.
function coturn(env) {
  return {
    name: 'coturn',
    async mint(ttl) {
      const username = `${Math.floor(Date.now() / 1000) + ttl}:${randomBytes(8).toString('hex')}`;
      const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
      return turnOnly([{ urls: env.TURN_URL.split(','), username, credential }]);
    },
    async revoke() {},
    async egress() {
      return { total: 0, lastDay: 0 };
    },
  };
}

// Keeps TURN URLs only. STUN is the browser's choice, and port 53 is blocked by browsers,
// so without trickle ICE it only adds a gathering timeout. Every entry shares one username,
// so revoking that username ends everything handed out.
function turnOnly(servers) {
  const usable = (Array.isArray(servers) ? servers : [])
    .filter((s) => typeof s?.username === 'string' && typeof s.credential === 'string')
    .map((s) => ({
      urls: [s.urls].flat().filter((u) => typeof u === 'string' && /^turns?:/.test(u) && !/:53(\?|$)/.test(u)),
      username: s.username,
      credential: s.credential,
    }))
    .filter((s) => s.urls.length);
  const username = usable[0]?.username;
  if (!username) throw new Error('relay returned no usable TURN servers');
  return { iceServers: usable.filter((s) => s.username === username), username };
}
