// The sender's page: fresh links, Copy and its fallbacks, the QR code, and the layout at phone width.
// BASE=http://localhost:8090 node ui.mjs
import fs from 'node:fs';
import { browser, watch, startSender } from './lib.mjs';

const BASE = process.env.BASE ?? 'http://localhost:8090';
const file = '/tmp/ui-test.txt';
fs.writeFileSync(file, 'hello');
const log = [], fails = [];
const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : (fails.push(what), console.log(`FAIL ${what}`)));

const b = await browser();
const ctx = b.defaultBrowserContext();
await ctx.overridePermissions(new URL(BASE).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
const page = await b.newPage();
await watch(page, 'send', log);
page.on('dialog', (d) => d.accept());

const first = await startSender(page, BASE, file);
const second = await startSender(page, BASE, file);
check(/#[a-z0-9]{20}$/.test(first) && /#[a-z0-9]{20}$/.test(second), 'link ends in a 20-character secret');
check(first !== second, 'each send makes a new link');

await page.click('#copy');
await page.waitForFunction(() => document.querySelector('#copied').textContent);
check((await page.evaluate(() => navigator.clipboard.readText())) === second, 'Copy puts the link on the clipboard');
check((await page.$eval('#copied', (e) => e.textContent)) === 'Copied.', 'Copy says Copied.');

await page.evaluate(() => {
  navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  document.execCommand = () => false;
  document.activeElement.blur();
});
await page.click('#copy');
await page.waitForFunction(() => document.querySelector('#copied').textContent.includes('blocked'));
const sel = await page.evaluate(() => {
  const i = document.querySelector('#link');
  return document.activeElement === i && i.selectionStart === 0 && i.selectionEnd === i.value.length;
});
check(sel, 'when copying is blocked, the whole link is selected and focused');
check((await page.$eval('#copied', (e) => e.textContent)).includes('+C'), 'when copying is blocked, it says how to copy by hand');

await page.goto(BASE);
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['a'], 'a.txt'));
  dt.items.add(new File(['b'], 'b.txt'));
  dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
});
check((await page.$eval('#msg', (e) => e.textContent)).startsWith('One file at a time'), 'dropping two files explains one at a time');
check(await page.$eval('#send', (e) => e.hidden), 'dropping two files sends nothing');
const shown = await startSender(page, BASE, file);

// every version the encoder supports, and the real link, must scan back to the same text
const texts = [shown, 'a', 'x'.repeat(17), 'y'.repeat(32), 'z'.repeat(53), 'w'.repeat(78), 'v'.repeat(106), 'u'.repeat(134)];
const scans = await page.evaluate(async (texts) => {
  const out = [];
  for (const t of texts) {
    const svg = t === texts[0] ? document.querySelector('#qr svg') : qr(t);
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(svg).replace('<svg ', '<svg width="400" height="400" '));
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: 400, height: 400 });
    c.getContext('2d').drawImage(img, 0, 0, 400, 400);
    const [hit] = await new BarcodeDetector({ formats: ['qr_code'] }).detect(c);
    out.push(hit?.rawValue === t);
  }
  return { out, tooLong: qr('t'.repeat(135)) === null };
}, texts);
scans.out.forEach((ok, i) => check(ok, `QR scans back to its text (${texts[i].length} bytes)`));
check(scans.tooLong, 'QR declines text past version 6');

await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
await startSender(page, BASE, file);
const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
check(fits, 'no sideways scrolling at 360px wide');
await page.screenshot({ path: '/tmp/ui-phone.png', fullPage: true });

check(!log.length, `no console errors or CSP violations${log.length ? `: ${log.join(' | ')}` : ''}`);
await b.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exit(fails.length ? 1 : 0);
