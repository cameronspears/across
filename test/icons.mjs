// node test/icons.mjs: renders public/logo.svg into the PNG icons and the og.png share card.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const repo = new URL('..', import.meta.url).pathname;
const out = process.argv[2] || `${repo}public`;
const exe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mark = fs.readFileSync(`${repo}public/logo.svg`, 'utf8').trim();
const glyph = mark.replace(/<rect[^>]*\/>/, '').replace(/^<svg[^>]*>|<\/svg>$/g, '');
const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#111"/>${glyph}</svg>`;
const font = `-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif`;
const sized = (svg, w, h) => svg.replace('<svg ', `<svg width="${w}" height="${h}" `);
const jobs = [
  ['apple-touch-icon.png', 180, 180, sized(bleed, 180, 180)],
  ['icon-192.png', 192, 192, sized(mark, 192, 192)],
  ['icon-512.png', 512, 512, sized(mark, 512, 512)],
  ['og.png', 1200, 630, `<div style="width:1200px;height:630px;background:#fafafa;display:flex;flex-direction:column;justify-content:center;padding:0 120px;box-sizing:border-box;font-family:${font};color:#111">
    <div style="display:flex;align-items:center;gap:40px">${sized(mark, 140, 140)}
    <div style="font-size:128px;font-weight:700;letter-spacing:-4px;line-height:1">Across</div></div>
    <div style="font-size:44px;line-height:1.35;margin-top:56px;color:#444;letter-spacing:-0.5px">Send large files straight from your browser to theirs.<br>Free, encrypted, no account, no size limit.</div></div>`],
];
const b = await puppeteer.launch({ executablePath: exe, headless: true });
const p = await b.newPage();
for (const [name, w, h, html] of jobs) {
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await p.screenshot({ path: `${out}/${name}`, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
await b.close();
