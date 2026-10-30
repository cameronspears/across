// Codes: a receiver types the sender's six letters on the home page instead of opening the link.
// A right code gets the file, a wrong one is refused on both sides, and three wrong ones retire it.
// [SENDER=firefox] node code.mjs [base]
import fs from 'node:fs';
import { browser, launch, watch, download, waitFile, sha } from './lib.mjs';

const BASE = process.argv[2] ?? 'http://localhost:8090';
const dir = '/tmp/code-test', file = '/tmp/code-test.bin';
fs.rmSync(dir, { recursive: true, force: true });
fs.writeFileSync(file, Buffer.alloc(3 << 20, 7));
const log = [], fails = [];
const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : (fails.push(what), console.log(`FAIL ${what}`)));

const sb = process.env.SENDER === 'firefox' ? await launch('firefox') : await browser(), rb = await browser(dir);
const send = await sb.newPage();
await watch(send, 'send', log);
await send.goto(BASE);
await (await send.$('#file')).uploadFile(file);
await send.waitForFunction(() => document.querySelector('#code-out').textContent, { timeout: 10_000 });
const shown = await send.$eval('#code-out', (e) => e.textContent);
const code = shown.replace(' ', '').toLowerCase();
check(/^[A-Z]{3} [A-Z]{3}$/.test(shown) && /^[bcdfghjkmnpqrstvwxz]{6}$/.test(code), `sender shows a code (${shown})`);
check(await send.$eval('label[for=link]', (e) => e.textContent === 'Or send them this link'), 'the link becomes the second way');

// types on the home page and waits for the receiver to settle: a file to download, or an error
async function enter(typed, submit) {
  const recv = await rb.newPage();
  await watch(recv, 'recv', log);
  await recv.goto(BASE);
  await recv.type('#code', typed);
  if (submit) await recv.keyboard.press('Enter');
  await recv.waitForFunction(() => !document.querySelector('#go').hidden || document.querySelector('#msg').dataset.kind === 'error' ||
    document.querySelector('#code-msg').textContent, { timeout: 30_000 });
  return recv;
}
const msg = (page) => page.$eval('#msg', (e) => e.textContent);

const bad = await enter('bca efg', true);
check((await bad.$eval('#code-msg', (e) => e.textContent)).includes('consonants'), 'a code with vowels is refused before it is tried');
await bad.close();

const ok = await enter(shown.toLowerCase());
check(!(await ok.$eval('#go', (e) => e.hidden)), 'the right code, typed in lower case with its space, connects');
const r = await download(ok, fs.statSync(file).size);
const got = `${dir}/code-test.bin`;
check(await waitFile(got, fs.statSync(file).size) && sha(got) === sha(file), `the file arrives intact (${r.secs.toFixed(1)}s)`);
await ok.close();

const other = (c) => c.slice(0, 2) + [...c.slice(2)].map((x) => (x === 'b' ? 'c' : 'b')).join('');
const unknown = code[0] === 'z' ? 'x' : 'z';
const none = await enter(`${unknown}${unknown}bbbb`);
check((await msg(none)).startsWith('No file is waiting'), 'a code no sender holds says so');
await none.close();

for (let i = 1; i <= 3; i++) {
  const wrong = await enter(other(code));
  check((await msg(wrong)).startsWith("That code doesn't match"), `wrong code ${i} is refused`);
  check(await wrong.$eval('#msg a', (e) => e.textContent === 'Type it again' && document.activeElement === e).catch(() => false),
    `wrong code ${i} offers to type it again`);
  await wrong.close();
}
await send.waitForFunction(() => document.querySelector('#code-box').textContent.includes('stopped working'), { timeout: 5000 })
  .then(() => check(true, 'three wrong codes retire the code on the sender'), () => check(false, 'three wrong codes retire the code on the sender'));
const late = await enter(shown);
check((await msg(late)).startsWith('No file is waiting'), 'a retired code no longer leads to the sender');

await sb.close();
await rb.close();
// the unknown codes' 404s, and the release a closing sender sends, are expected
const noise = log.filter((l) => !/api\/code|status of 404/.test(l));
for (const line of noise) console.log(line);
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exit(fails.length || noise.length ? 1 : 0);
