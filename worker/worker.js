// Runs the app's budget guard once a minute, so credentials get revoked at the budget even when nobody visits.
export default {
  async scheduled(controller, env) {
    if (!env.APP_URL) throw new Error('APP_URL is not set; set it under [vars] in wrangler.toml');
    const response = await fetch(new URL('/api/guard', env.APP_URL), { headers: { 'Cache-Control': 'no-store' } });
    const body = await response.text();
    console.log(`guard ${response.status} ${body}`);
    if (!response.ok) throw new Error(`guard answered ${response.status}`);
  },
};
