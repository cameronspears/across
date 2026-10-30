// node setup-time.mjs <baseUrl> <runs>: where the time goes between opening the link and the Download button,
// both sides hidden, from each request's start and each signaling message's kind.
import { browser, startSender } from './lib.mjs';

const [base, runs = 3] = process.argv.slice(2);
const file = new URL('./package.json', import.meta.url).pathname;
for (let i = 0; i < Number(runs); i++) {
  const t = {}, pages = {};
  let t0 = 0;
  for (const side of ['send', 'recv']) {
    const page = await (await browser(undefined, ['--disable-features=WebRtcHideLocalIpsWithMdns'])).newPage();
    await page.evaluateOnNewDocument(() => localStorage.setItem('hide-ip', '1'));
    page.on('request', (r) => {
      if (!t0) return;
      const u = r.url(), at = Date.now() - t0;
      if (u.includes('/api/ice')) t[`${side} ice`] ??= at;
      if (u.includes('/api/signal') && r.method() === 'POST') t[`${side} ${JSON.parse(r.postData()).data.t}`] ??= at;
    });
    pages[side] = page;
  }
  await startSender(pages.send, base, file);
  const link = await pages.send.$eval('#link', (e) => e.value);
  t0 = Date.now();
  await pages.recv.goto(link);
  await pages.recv.waitForSelector('#go:not([hidden])', { timeout: 60_000 });
  t['recv ready'] = Date.now() - t0;
  console.log(Object.entries(t).sort((a, b) => a[1] - b[1]).map(([k, v]) => `${k} ${v}`).join(' | '));
  for (const p of Object.values(pages)) await p.browser().close();
}
process.exit(0);
