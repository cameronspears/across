// node lost.mjs <dir> <baseUrl> <hello|offer|answer>: the first POST of that message never reaches the
// server; the handshake must still converge and the file must arrive intact.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { browser, watch, startSender, download, waitFile, sha } from './lib.mjs';

const [dir, base, drop] = process.argv.slice(2);
const file = `${dir}/small.bin`;
if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(5_000_000));
const bytes = fs.statSync(file).size, want = sha(file), out = `${dir}/dl-lost-${drop}`;
fs.rmSync(out, { recursive: true, force: true });
const log = [];
const send = await (await browser()).newPage(), recv = await (await browser(out)).newPage();
await watch(send, 'send', log);
await watch(recv, 'recv', log);
const target = drop === 'offer' ? send : recv;
let dropped = 0;
await target.setRequestInterception(true);
target.on('request', (r) => {
  const isIt = r.method() === 'POST' && r.url().includes('/api/signal') && JSON.parse(r.postData()).data.t === drop;
  if (isIt && !dropped++) return r.abort();
  r.continue();
});
const link = await startSender(send, base, file);
const t0 = Date.now();
await recv.goto(link);
await recv.waitForSelector('#go:not([hidden])', { timeout: 40_000 });
const ready = Date.now() - t0;
const posts = [...send.posts, ...recv.posts].map((p) => p.data.t);
const r = await download(recv, bytes, 60_000);
const saved = await waitFile(`${out}/small.bin`, bytes);
const got = saved ? sha(`${out}/small.bin`) : 'missing';
console.log(`dropped first ${drop} (${dropped} seen) | link->ready ${ready}ms | posts ${posts.join(',')} | msg="${r.msg}" | sha ${got === want ? 'ok' : got}`);
// the request this test aborts on purpose logs ERR_FAILED
const errors = log.filter((l) => !l.includes('net::ERR_FAILED'));
const pass = dropped >= 2 && got === want && !errors.length;
console.log(pass ? 'PASS' : 'FAIL', errors);
process.exit(pass ? 0 : 1);
