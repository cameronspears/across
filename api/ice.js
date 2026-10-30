import { guardFromEnv } from '../lib/guard.js';

const { admit } = guardFromEnv();

// Vercel overwrites both headers with the address the request came from.
const clientIp = (request) =>
  request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '';

// 200 { iceServers } | 503 { relay: 'off' | 'budget' } | 429 { relay: 'busy', retry: seconds } | 502 { relay: 'error' }
export async function GET(request) {
  const [status, body] = await admit(clientIp(request));
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}
