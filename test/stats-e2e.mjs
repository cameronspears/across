// node stats-e2e.mjs <dir> <baseUrl> <captured.jsonl>: a transfer sends the expected usage events, all accepted,
// and none of them carry the file name, link or code. Start dev.mjs with POSTHOG_HOST pointing at a capture stub.
import fs from 'node:fs';
import { browser, watch, startSender, download, sleep } from './lib.mjs';

const [dir, base, captured] = process.argv.slice(2);
const file = `${dir}/photo.jpg`, bytes = fs.statSync(file).size;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const log = [], refused = [];
const pages = [];
for (const d of [undefined, `${dir}/dl-stats`]) {
  const page = await (await browser(d)).newPage();
  await page.setUserAgent(UA);
  await watch(page, d ? 'recv' : 'send', log);
  page.on('response', (r) => r.url().includes('api/event') && r.status() !== 204 && refused.push(`${r.status()} ${r.request().postData()}`));
  pages.push(page);
}
const [send, recv] = pages;
const link = await startSender(send, base, file);
await recv.goto(link);
await recv.waitForSelector('#go:not([hidden])', { timeout: 30_000 });
await download(recv, bytes);
await sleep(1500);
const events = fs.readFileSync(captured, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const names = events.map((e) => `${e.event}${e.properties.role ? `:${e.properties.role}` : ''}`);
console.log(names.join(' '));
const want = ['$pageview', 'file_picked', 'connected:sender', 'connected:receiver', 'transfer_started:sender', 'transfer_started:receiver', 'transfer_completed:sender', 'transfer_completed:receiver'];
const missing = want.filter((w) => !names.includes(w));
const secret = link.split('#')[1];
const leaks = events.filter((e) => JSON.stringify(e).includes('photo') || JSON.stringify(e).includes(secret));
console.log('completed:', JSON.stringify(events.filter((e) => e.event === 'transfer_completed').map((e) => e.properties)));
console.log(`missing ${missing}; refused ${refused.length} ${refused}; leaks ${leaks.length}; console errors ${log.length}`, log);
process.exit(!missing.length && !refused.length && !leaks.length && !log.length ? 0 : 1);
