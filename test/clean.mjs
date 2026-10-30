// node clean.mjs <dir> <baseUrl>: one full transfer with every console error, page error, and CSP violation recorded.
import fs from 'node:fs';
import { browser, watch, startSender, download, waitFile, sha, WANT } from './lib.mjs';

const dir = process.argv[2], base = process.argv[3];
const file = `${dir}/xbox.zip`, bytes = fs.statSync(file).size, out = `${dir}/dl-clean`;
fs.rmSync(out, { recursive: true, force: true });
const log = [];
const A = await browser(), B = await browser(out);
const send = await A.newPage(), recv = await B.newPage();
await watch(send, 'send', log);
await watch(recv, 'recv', log);
const link = await startSender(send, base, file);
const t0 = Date.now();
await recv.goto(link);
await recv.waitForSelector('#go:not([hidden])', { timeout: 30_000 });
const ready = Date.now() - t0;
const r = await download(recv, bytes);
const saved = await waitFile(`${out}/xbox.zip`, bytes);
const posts = [...send.posts, ...recv.posts];
console.log(`link->ready ${ready}ms | ${r.mbps.toFixed(1)}MB/s | max stall ${r.maxGap}ms | msg="${r.msg}"`);
console.log('signaling posts:', posts.map((p) => `${p.data.t}:${JSON.stringify(p).length}B`).join(' '));
console.log('sha', saved ? sha(`${out}/xbox.zip`) : 'missing', `(want ${WANT})`);
console.log(`console errors, page errors, CSP violations: ${log.length}`);
for (const line of log) console.log('  ' + line);
process.exit(log.length || !saved ? 1 : 0);
