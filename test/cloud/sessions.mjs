// node sessions.mjs: every session of both benchmark sandboxes, with active CPU and network transfer
import fs from 'node:fs';
import { Sandbox } from '@vercel/sandbox';
for (const line of fs.readFileSync(new URL('./.env.sandbox', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^(VERCEL_OIDC_TOKEN)="?([^"]*)"?$/);
  if (m) process.env[m[1]] = m[2];
}
let cpu = 0, egress = 0, ingress = 0;
for (const name of ['ftbench-a', 'ftbench-b']) {
  const sb = await Sandbox.get({ name, resume: false });
  const res = await sb.listSessions();
  const list = res.sessions ?? (await res.toArray?.()) ?? res;
  for (const s of list) {
    const c = s.activeCpuDurationMs ?? s.activeCpuUsageMs ?? 0, n = s.networkTransfer ?? {};
    cpu += c; egress += n.egress ?? 0; ingress += n.ingress ?? 0;
    console.log(name, s.id, s.status, new Date(s.startedAt).toISOString(), `${Math.round((s.duration ?? 0) / 1000)}s`, `cpu ${c}ms`, `egress ${n.egress} ingress ${n.ingress}`);
  }
}
console.log(`total active CPU ${(cpu / 3.6e6).toFixed(3)} h, egress ${egress}, ingress ${ingress}`);
