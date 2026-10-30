// node limits.mjs <project>: RELAY_BUDGET_GB above 1000, or not a number of at least 0, falls back to 900 and logs
// why; an unusable RELAY_MINTS_PER_HOUR falls back to 60. A refusal says how many seconds until the next hour. Read through /api/guard's budgetGB and /api/ice's 429.
import { iceInstance, guardInstance, stub } from './ice-env.mjs';

const [project] = process.argv.slice(2);
const failures = [];
const expect = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); ok || failures.push(what); };
async function logged(load) {
  const lines = [], error = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    return [await load(), lines];
  } finally {
    console.error = error;
  }
}

await stub('reset', {});
await stub('usage', { bytes: 0 });
const budgets = [[undefined, 900], ['900', 900], ['1000', 1000], ['1e3', 1000], ['0', 0], ['250.5', 250.5],
  ['1000.01', 900], ['1001', 900], ['5000', 900], ['Infinity', 900], ['-1', 900], ['abc', 900], ['', 900], [' ', 900]];
for (const [raw, want] of budgets) {
  const [g, lines] = await logged(() => guardInstance(project, 'memory', `limit-${Math.random()}`, raw === undefined ? {} : { RELAY_BUDGET_GB: raw }));
  const { body } = await g();
  const warned = lines.some((l) => l.includes('RELAY_BUDGET_GB') && l.includes('at most 1000'));
  expect(body.budgetGB === want && warned === (raw !== undefined && want === 900 && raw !== '900'),
    `RELAY_BUDGET_GB=${JSON.stringify(raw)} -> ${body.budgetGB} GB${warned ? `, logged: ${lines.find((l) => l.includes('RELAY_BUDGET_GB'))}` : ''}`);
}
for (const raw of [undefined, '-5', 'twelve']) {
  const [ice, lines] = await logged(() => iceInstance(project, 'memory', `mints-${Math.random()}`, raw === undefined ? {} : { RELAY_MINTS_PER_HOUR: raw }));
  const client = `192.0.2.${Math.floor(Math.random() * 250)}`;
  const statuses = [];
  let last;
  for (let i = 0; i < 61; i++) statuses.push((last = await ice(client)).status);
  const retry = last.body?.retry;
  const warned = lines.some((l) => l.includes('RELAY_MINTS_PER_HOUR'));
  expect(statuses.slice(0, 60).every((s) => s === 200) && statuses[60] === 429 && retry > 0 && retry <= 3600 && warned === (raw !== undefined),
    `RELAY_MINTS_PER_HOUR=${JSON.stringify(raw)} -> 60 mints then 429, retry in ${retry}s: ${[...new Set(statuses)].join(',')}${warned ? `, logged: ${lines[0]}` : ''}`);
}
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
