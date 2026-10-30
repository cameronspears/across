// Vercel analytics on the live hostname only: pages load both scripts under the CSP, every reported URL
// is cut to its path, and the opt-out stops them. acrossfile.com is mapped to the local dev server and
// the /_vercel scripts are stubs that run beforeSend and record what would be sent.
// Usage: node vercel-stats.mjs (with test/servers.sh running)
import { launch } from './lib.mjs';

const b = await launch('chrome', ['--host-resolver-rules=MAP acrossfile.com 127.0.0.1:8090']);
const stub = (q) => `for (const a of window.${q}q || []) if (a[0] === 'beforeSend') window.__sent = (window.__sent || []).concat(a[1]({ type: '${q}', url: location.href }).url);`;
let fail = 0;
const ok = (c, m) => (console.log(c ? 'ok  ' : 'FAIL', m), c || fail++);
async function visit(url, { optOut = false } = {}) {
  const page = await b.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const m = /\/_vercel\/(insights|speed-insights)\/script\.js$/.exec(r.url());
    if (m) r.respond({ contentType: 'text/javascript', body: stub(m[1] === 'insights' ? 'va' : 'si') });
    else r.continue();
  });
  if (optOut) {
    await page.goto(new URL('/privacy', url).href);
    await page.evaluate(() => localStorage.setItem('no-stats', '1'));
  }
  await page.goto(url, { waitUntil: 'networkidle0' });
  const sent = await page.evaluate(() => window.__sent || []);
  await page.close();
  return { sent, errors };
}
for (const path of ['/#abc-secret-def?x', '/how?utm_source=t', '/privacy']) {
  const { sent, errors } = await visit(`http://acrossfile.com${path}`);
  const want = `http://acrossfile.com${path.replace(/[?#].*/, '')}`;
  ok(sent.length === 2 && sent.every((u) => u === want), `${path}: both scripts load, report ${want} (got ${sent.join(', ')})`);
  ok(!errors.some((e) => /Content Security Policy/.test(e)), `${path}: no CSP errors ${errors.join(' | ')}`);
}
ok((await visit('http://acrossfile.com/', { optOut: true })).sent.length === 0, 'opt-out: nothing loads');
ok((await visit('http://localhost:8090/')).sent.length === 0, 'localhost: nothing loads');
await b.close();
process.exit(fail ? 1 : 0);
