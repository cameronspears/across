import { guardFromEnv } from '../lib/guard.js';
import { clientIp, crossSite } from '../lib/limit.js';

const { admit } = guardFromEnv();

// 200 { iceServers } | 503 { relay: 'off' | 'budget' } | 429 { relay: 'busy', retry: seconds } | 502 { relay: 'error' }
export async function GET(request) {
  if (crossSite(request)) return new Response(null, { status: 403 });
  const [status, body] = await admit(clientIp(request));
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}
