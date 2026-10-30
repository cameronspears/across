// node photos.mjs <baseUrl>: a receiver that keeps files in memory, as on an iPhone, offers a photo or video
// to the share sheet (where Save Image puts it in Photos) as a file of the right type, and anything else as
// a plain download. The share sheet is stubbed so the test sees exactly what it would get.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { browser, watch, startSender } from './lib.mjs';

const [base] = process.argv.slice(2);
const fails = [];
const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : (fails.push(what), console.log(`FAIL ${what}`)));
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function receive(name, bytes) {
  const file = `/tmp/${name}`;
  fs.writeFileSync(file, bytes);
  const log = [];
  const [s, r] = [await (await browser()).newPage(), await (await browser()).newPage()];
  await watch(s, 'send', log);
  await watch(r, 'recv', log);
  s.on('dialog', (d) => d.accept());
  await r.evaluateOnNewDocument(() => {
    navigator.canShare = (data) => Array.isArray(data?.files);
    navigator.share = async ({ files }) => {
      const [f] = files;
      const digest = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      window.__shared = { name: f.name, type: f.type, size: f.size, sha: Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('') };
    };
  });
  const link = await startSender(s, base, file);
  await r.goto(link.replace('#', '?sink=mem#'));
  await r.waitForSelector('#go:not([hidden])', { timeout: 30_000 });
  await r.click('#go');
  await r.waitForFunction(() => document.querySelector('#msg').textContent.startsWith('Done'), { timeout: 60_000 });
  const ui = await r.evaluate(() => ({ button: document.querySelector('#msg button')?.textContent ?? null, link: document.querySelector('#msg a')?.textContent ?? null }));
  if (ui.button) await r.click('#msg button');
  const shared = await r.waitForFunction(() => window.__shared, { timeout: 5000 }).then((h) => h.jsonValue(), () => null);
  await s.browser().close();
  await r.browser().close();
  return { ui, shared, log, want: hash(bytes) };
}

const photo = await receive('beach.jpg', crypto.randomBytes(300_000));
check(photo.ui.button === 'Save to Photos' && photo.ui.link === 'Save file', `a photo offers Save to Photos or Save file (${JSON.stringify(photo.ui)})`);
check(photo.shared?.type === 'image/jpeg' && photo.shared?.name === 'beach.jpg', `the share sheet gets image/jpeg named beach.jpg (${JSON.stringify(photo.shared)})`);
check(photo.shared?.sha === photo.want, 'the shared photo is the exact file sent');

const video = await receive('clip.MOV', crypto.randomBytes(200_000));
check(video.shared?.type === 'video/quicktime' && video.shared?.sha === video.want, `a .MOV goes to the share sheet as video/quicktime (${video.shared?.type})`);

const doc = await receive('notes.txt', Buffer.from('hello'));
check(doc.ui.button === null && doc.ui.link === 'Save file' && !doc.shared, `a text file is a plain download with no share button (${JSON.stringify(doc.ui)})`);

const logs = [...photo.log, ...video.log, ...doc.log];
check(!logs.length, `no console errors${logs.length ? `: ${logs.join(' | ')}` : ''}`);
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exit(fails.length ? 1 : 0);
