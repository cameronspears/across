// Snapshots of CPU ticks per Chrome process and thread, the machine's busy ticks, and
// interface byte counters, so a run can report what each side's CPU and network did.
import fs from 'node:fs';

const HZ = 100;
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const ticks = (stat) => {
  const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return Number(f[11]) + Number(f[12]);
};

function kind(cmd) {
  if (/node$/.test(cmd.split(/[\s\0]/)[0])) return 'node';
  if (/--top-chrome-webui/.test(cmd)) return 'renderer:webui';
  const type = cmd.match(/--type=([^\s\0]+)/)?.[1];
  if (!type) return 'browser';
  const sub = cmd.match(/--utility-sub-type=([^\s\0]+)/)?.[1];
  return sub ? `utility:${sub.split('.').slice(-1)[0]}` : type;
}

export function snap() {
  const procs = {};
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    const cmd = read(`/proc/${pid}/cmdline`);
    if (!/chrome|node/.test(cmd.split('\0')[0])) continue;
    const threads = {};
    for (const tid of fs.readdirSync(`/proc/${pid}/task`, { throwIfNoEntry: false }) ?? []) {
      const st = read(`/proc/${pid}/task/${tid}/stat`);
      if (st) threads[tid] = { name: st.slice(st.indexOf('(') + 1, st.lastIndexOf(')')), t: ticks(st) };
    }
    procs[pid] = { kind: kind(cmd), threads };
  }
  const cpu = read('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const busy = cpu.reduce((a, b) => a + b, 0) - cpu[3] - cpu[4];
  const net = { rx: 0, tx: 0 };
  for (const line of read('/proc/net/dev').split('\n').slice(2)) {
    const [name, rest] = line.split(':');
    if (!rest || name.trim() === 'lo') continue;
    const f = rest.trim().split(/\s+/).map(Number);
    net.rx += f[0];
    net.tx += f[8];
  }
  // kernel UDP and TCP counters: socket-buffer drops and retransmissions on this machine
  const snmp = {};
  const lines = read('/proc/net/snmp').split('\n');
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const [proto, ...keys] = lines[i].split(/\s+/), vals = lines[i + 1].split(/\s+/).slice(1);
    if (proto === 'Udp:' || proto === 'Tcp:') keys.forEach((k, j) => (snmp[proto[0] + ':' + k] = Number(vals[j])));
  }
  return { at: Date.now(), procs, busy, net, snmp };
}

// percent of one core, per process kind and for the busiest threads
export function diff(a, b) {
  const secs = (b.at - a.at) / 1000;
  const pct = (t) => Math.round((t / HZ / secs) * 1000) / 10;
  const byKind = {}, threads = [];
  for (const [pid, p] of Object.entries(b.procs)) {
    let sum = 0;
    for (const [tid, th] of Object.entries(p.threads)) {
      const d = th.t - (a.procs[pid]?.threads[tid]?.t ?? 0);
      sum += d;
      if (d > 0) threads.push({ kind: p.kind, name: th.name, pct: pct(d) });
    }
    byKind[p.kind] = (byKind[p.kind] ?? 0) + pct(sum);
  }
  for (const k in byKind) byKind[k] = Math.round(byKind[k] * 10) / 10;
  threads.sort((x, y) => y.pct - x.pct);
  return {
    secs,
    machinePct: pct(b.busy - a.busy),
    byKind,
    topThreads: threads.slice(0, 6),
    txMB: (b.net.tx - a.net.tx) / 1e6,
    rxMB: (b.net.rx - a.net.rx) / 1e6,
    kernel: Object.fromEntries(['U:InDatagrams', 'U:OutDatagrams', 'U:RcvbufErrors', 'U:SndbufErrors', 'U:InErrors', 'T:OutSegs', 'T:RetransSegs']
      .map((k) => [k, (b.snmp[k] ?? 0) - (a.snmp[k] ?? 0)])),
  };
}
