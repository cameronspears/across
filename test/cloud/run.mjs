// node run.mjs setup | speed | stop | usage
// node run.mjs app <label> <sendHide 1|0> <recvHide 1|0> <bytes> [page.json]
// node run.mjs bench <label> '<cfg json>'
// node run.mjs plan <plan.json> <rounds>   runs every entry once per round, in order, so variants alternate
// Two persistent 4 vCPU sandboxes in iad1: A sends, B receives. Each run appends a line to runs.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Sandbox } from '@vercel/sandbox';

const HERE = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(`${HERE}/.env.sandbox`, 'utf8').split('\n')) {
  const m = line.match(/^(VERCEL_OIDC_TOKEN)="?([^"]*)"?$/);
  if (m) process.env[m[1]] = m[2];
}
const NAMES = { A: 'ftbench-a', B: 'ftbench-b' };
const HOME = '/vercel/sandbox';
const MAX_AGE_S = 36 * 60;
const append = (file, o) => fs.appendFileSync(`${HERE}/${file}`, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');

const boxes = {};
async function box(side) {
  return (boxes[side] ??= await Sandbox.getOrCreate({
    name: NAMES[side], region: 'iad1', resources: { vcpus: 4 }, timeout: 45 * 60_000,
    persistent: true, keepLastSnapshots: { count: 1 }, resume: true,
  }));
}

async function sh(side, script, { sudo = false, ok = false } = {}) {
  const r = await (await box(side)).runCommand({ cmd: 'bash', args: ['-c', script], sudo, cwd: HOME });
  const out = await r.stdout(), err = await r.stderr();
  if (r.exitCode && !ok) throw new Error(`${side} exit ${r.exitCode}: ${(err || out).slice(-3000)}`);
  return out;
}

async function push(side) {
  const dir = `${HERE}/remote`;
  await (await box(side)).writeFiles(fs.readdirSync(dir).map((f) => ({ path: `${HOME}/${f}`, content: fs.readFileSync(`${dir}/${f}`) })));
}

// a session lasts at most 45 minutes; start a fresh one before a run could cross that
async function fresh(side) {
  const up = Number((await sh(side, 'cut -d" " -f1 /proc/uptime')).trim());
  if (up < MAX_AGE_S) return;
  await stop(side);
  await sh(side, 'true');
}

async function stop(side) {
  const sb = await box(side);
  const s = await sb.stop();
  append('usage.jsonl', { side, name: NAMES[side], cpuMs: sb.activeCpuUsageMs ?? s?.activeCpuUsageMs ?? s?.session?.activeCpuUsageMs, net: sb.networkTransfer ?? s?.networkTransfer, raw: s });
  delete boxes[side];
}

const resultOf = (out) => {
  const line = out.split('\n').find((l) => l.startsWith('RESULT '));
  return line ? JSON.parse(line.slice(7)) : { error: `no RESULT: ${out.slice(-1500)}` };
};

async function detached(side, args) {
  return (await box(side)).runCommand({ cmd: 'node', args, cwd: HOME, detached: true });
}

async function bench(label, cfg) {
  await Promise.all(['A', 'B'].map(fresh));
  const seed = crypto.randomBytes(12).toString('hex');
  const [s, r] = await Promise.all([
    detached('A', [`${HOME}/bench.mjs`, 'send', seed, JSON.stringify(cfg)]),
    detached('B', [`${HOME}/bench.mjs`, 'recv', seed, JSON.stringify(cfg)]),
  ]);
  const [so, ro] = await Promise.all([s.wait().then((c) => c.stdout()), r.wait().then((c) => c.stdout())]);
  const run = { kind: 'bench', label, cfg, send: resultOf(so), recv: resultOf(ro) };
  append('runs.jsonl', run);
  const p = run.recv.pairs?.[0];
  console.log(`${label}: ${run.recv.MBps?.toFixed(2) ?? 'ERR'} MB/s steady ${run.recv.steadyMBps?.toFixed(2)} ok=${run.recv.ok} ${p?.local ?? ''} rtt=${p?.rttMs} sendCPU=${JSON.stringify(run.send.cpu?.byKind)} recvCPU=${JSON.stringify(run.recv.cpu?.byKind)} ${run.send.error ?? ''}${run.recv.error ?? ''}`.slice(0, 900));
  return run;
}

async function app(label, sHide, rHide, bytes, pageFile) {
  await Promise.all(['A', 'B'].map(fresh));
  const extra = [];
  if (pageFile) {
    for (const side of ['A', 'B']) await (await box(side)).writeFiles([{ path: `${HOME}/page.json`, content: fs.readFileSync(pageFile) }]);
    extra.push(`${HOME}/page.json`);
  }
  await sh('A', `rm -f ${HOME}/result-send.txt`);
  const s = await detached('A', [`${HOME}/app.mjs`, 'send', sHide, String(bytes), ...extra]);
  let link, sout = '';
  for await (const log of s.logs()) {
    if (log.stream !== 'stdout') continue;
    sout += log.data;
    link = sout.match(/^LINK (\S+)/m)?.[1];
    if (link || sout.includes('RESULT ')) break;
  }
  if (!link) throw new Error(`sender gave no link: ${sout.slice(-1500)}`);
  const r = await detached('B', [`${HOME}/app.mjs`, 'recv', rHide, link, ...extra]);
  await s.wait();
  const so = (await (await box('A')).readFileToBuffer({ path: `${HOME}/result-send.txt` }))?.toString() ?? sout;
  const ro = await r.wait().then((c) => c.stdout());
  const run = { kind: 'app', label, sHide, rHide, bytes, page: pageFile ? path.basename(pageFile) : 'live', send: resultOf(so), recv: resultOf(ro) };
  run.ok = !!run.recv.sha && run.recv.sha === run.send.sha;
  append('runs.jsonl', run);
  const l = run.recv.links?.[0];
  console.log(`${label}: ${run.recv.MBps?.toFixed(2) ?? 'ERR'} MB/s ok=${run.ok} ${l?.local ?? ''} -> ${l?.remote ?? ''} rtt=${l?.rttMs} sendCPU=${JSON.stringify(run.send.cpu?.byKind)} recvCPU=${JSON.stringify(run.recv.cpu?.byKind)} ${run.send.error ?? ''}${run.recv.error ?? ''} ${run.recv.msg ?? ''}`.slice(0, 900));
  return run;
}

const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'setup') {
  for (const side of ['A', 'B']) {
    await push(side);
    console.log(side, await sh(side, `bash ${HOME}/setup.sh`, { sudo: true }));
  }
} else if (cmd === 'push') {
  await Promise.all(['A', 'B'].map(push));
} else if (cmd === 'speed') {
  for (const side of ['A', 'B']) {
    const out = (await sh(side, `bash ${HOME}/speed.sh`)).trim();
    append('capacity.jsonl', { side, out });
    console.log(side, out);
  }
} else if (cmd === 'sh') {
  console.log(await sh(a[0], a[1], { ok: true }));
} else if (cmd === 'stop') {
  for (const side of ['A', 'B']) await stop(side);
} else if (cmd === 'app') {
  await app(a[0], a[1], a[2], Number(a[3]), a[4]);
} else if (cmd === 'bench') {
  await bench(a[0], JSON.parse(a[1]));
} else if (cmd === 'plan') {
  const plan = JSON.parse(fs.readFileSync(a[0], 'utf8'));
  for (let round = 0; round < Number(a[1] ?? 1); round++) {
    for (const p of plan) {
      try {
        if (p.kind === 'app') await app(p.label, p.sHide, p.rHide, p.bytes, p.page);
        else await bench(p.label, p.cfg);
      } catch (err) {
        console.log(`${p.label}: THREW ${err.message.slice(0, 500)}`);
        append('runs.jsonl', { kind: p.kind, label: p.label, threw: err.message });
      }
    }
  }
} else {
  console.log('usage: see the header of run.mjs');
}
