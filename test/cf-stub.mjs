// node cf-stub.mjs [port]: stands in for Cloudflare's TURN key API and GraphQL usage API, for budget.mjs, limits.mjs
// and signal-limits.mjs. /stub/* sets what it answers and reports what it was asked (see ice-env.mjs stub()).
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2]) || 8099;
let s;
const reset = () => (s = { usage: { bytes: 0, today: 0 }, graphqlError: false, failRevoke: new Map(), usageQueries: [], mints: [], revokes: [] });
reset();

const json = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const path = new URL(req.url, 'http://x').pathname;
  let m;
  if (path === '/stub/reset') return reset(), json(res, 200, {});
  if (path === '/stub/usage') return (s.usage = { bytes: body.bytes, today: body.today ?? 0 }), json(res, 200, {});
  if (path === '/stub/graphql-error') return (s.graphqlError = body.on), json(res, 200, {});
  if (path === '/stub/fail-revoke') return s.failRevoke.set(body.username, body.times ?? 1), json(res, 200, {});
  if (path === '/stub/state') return json(res, 200, { usageQueries: s.usageQueries, mints: s.mints, revokes: s.revokes });
  if ((m = path.match(/^\/v1\/turn\/keys\/[^/]+\/credentials\/generate-ice-servers$/))) {
    const username = randomBytes(8).toString('hex');
    s.mints.push({ username, ttl: body.ttl });
    return json(res, 201, { iceServers: [
      { urls: ['stun:stun.example:3478'] },
      { urls: ['turn:turn.example:3478?transport=udp', 'turn:turn.example:53?transport=udp', 'turns:turn.example:443?transport=tcp'], username, credential: 'c' },
    ] });
  }
  if ((m = path.match(/^\/v1\/turn\/keys\/[^/]+\/credentials\/([^/]+)\/revoke$/))) {
    const username = decodeURIComponent(m[1]);
    s.revokes.push(username);
    const left = s.failRevoke.get(username) ?? 0;
    if (left > 0) return s.failRevoke.set(username, left - 1), json(res, 500, {});
    return json(res, 200, {});
  }
  if (path === '/client/v4/graphql') {
    s.usageQueries.push({ at: Date.now(), variables: body.variables, dataset: /callsTurnUsageAdaptiveGroups/.test(body.query), keyFilter: /keyId/.test(body.query) });
    if (s.graphqlError) return json(res, 200, { data: null, errors: [{ message: 'stub error' }] });
    const sum = (n) => [{ sum: { egressBytes: n } }];
    return json(res, 200, { data: { viewer: { accounts: [{ total: sum(s.usage.bytes), lastDay: sum(s.usage.today) }] } } });
  }
  json(res, 404, {});
}).listen(PORT, '127.0.0.1', () => console.log(`cf stub on ${PORT}`));
