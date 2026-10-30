// node compress-proto.mjs <file>...: per file, in 8 MB blocks like the app reads them, how much
// CompressionStream saves, how fast it compresses and decompresses in Chrome, and what a 64 KB probe predicts.
import { browser } from './lib.mjs';

const files = process.argv.slice(2);
const page = await (await browser()).newPage();
await page.setContent('<input type="file" multiple id="f">');
await (await page.$('#f')).uploadFile(...files);
console.log('formats:', await page.evaluate(() => ['gzip', 'deflate', 'deflate-raw', 'br', 'brotli', 'zstd'].filter((f) => { try { new CompressionStream(f); return true; } catch { return false; } })));
const results = await page.evaluate(async () => {
  const run = async (data, kind) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(kind)).arrayBuffer());
  const out = [];
  for (const file of document.querySelector('#f').files) {
    let raw = 0, packed = 0, ct = 0, dt = 0, probeOut = 0, probeIn = 0;
    for (let at = 0; at < file.size; at += 8 << 20) {
      const block = new Uint8Array(await file.slice(at, at + (8 << 20)).arrayBuffer());
      const probe = block.subarray(0, 64 << 10);
      probeIn += probe.length;
      probeOut += (await run(probe, new CompressionStream('deflate-raw'))).length;
      let t = performance.now();
      const z = await run(block, new CompressionStream('deflate-raw'));
      ct += performance.now() - t;
      t = performance.now();
      const back = await run(z, new DecompressionStream('deflate-raw'));
      dt += performance.now() - t;
      if (back.length !== block.length) throw new Error('round trip lost bytes');
      raw += block.length; packed += z.length;
    }
    out.push({ name: file.name, raw, ratio: packed / raw, probe: probeOut / probeIn, cMBs: raw / 1e3 / ct, dMBs: raw / 1e3 / dt });
  }
  return out;
});
for (const r of results) console.log(`${r.name.padEnd(12)} ${(r.raw / 1e6).toFixed(0).padStart(4)}MB  size after ${(r.ratio * 100).toFixed(0).padStart(3)}%  probe says ${(r.probe * 100).toFixed(0).padStart(3)}%  compress ${r.cMBs.toFixed(0)}MB/s  decompress ${r.dMBs.toFixed(0)}MB/s`);
process.exit(0);
