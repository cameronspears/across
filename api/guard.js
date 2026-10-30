import { guardFromEnv } from '../lib/guard.js';

const { check } = guardFromEnv();

// 200 { state, usedGB, budgetGB, todayGB, dailyGB, live, revoked } | 503 { relay: 'off' }
// Public: it can only run the budget check that /api/ice runs, against the same cached reading.
export async function GET() {
  const [status, body] = await check();
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}
