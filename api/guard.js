import { guardFromEnv } from '../lib/guard.js';

const { check } = guardFromEnv();

// 200 { state, usedGB, budgetGB, todayGB, dailyGB, live, revoked } | 503 { relay: 'off' }
// Public: it can only run the budget check that /api/ice runs, against the same cached reading. It takes no
// query, so other URLs never reach Redis, and the CDN answers repeats for 20 seconds, so a flood costs nothing.
// The cron calls once a minute, so every one of its calls still runs the check and its revokes.
export async function GET(request) {
  if (new URL(request.url).search) return new Response(null, { status: 400 });
  const [status, body] = await check();
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'max-age=20', 'Content-Type': 'application/json' },
  });
}
