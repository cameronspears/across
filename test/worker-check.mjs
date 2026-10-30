// node worker-check.mjs <project> <baseUrl> <offBaseUrl>: the cron worker's scheduled handler, run in Node with
// the real fetch against dev.mjs. It logs the guard's JSON, fails the run when the guard refuses, and names a
// missing APP_URL. offBaseUrl is a dev server with no relay configured.
import fs from 'node:fs';

const [project, base, off] = process.argv.slice(2);
const failures = [];
const expect = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); ok || failures.push(what); };
const { default: worker } = await import(`${project}/worker/worker.js`);
const controller = { cron: '* * * * *', scheduledTime: Date.now() };
async function run(env) {
  const lines = [], log = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await worker.scheduled(controller, env, { waitUntil() {} });
    return { lines };
  } catch (err) {
    return { lines, error: err.message };
  } finally {
    console.log = log;
  }
}

let r = await run({ APP_URL: base });
const json = JSON.parse(r.lines[0]?.match(/^guard 200 (.*)$/)?.[1] ?? 'null');
expect(!r.error && json && Object.keys(json).sort().join() === 'budgetGB,live,revoked,state,usedGB' && ['open', 'closed', 'unknown'].includes(json.state),
  `scheduled run fetches ${new URL('/api/guard', base)} and logs: ${r.lines.join(' | ')}${r.error ? ` (threw ${r.error})` : ''}`);
r = await run({ APP_URL: off });
expect(r.lines[0] === 'guard 503 {"relay":"off"}' && r.error === 'guard answered 503', `a refusing guard fails the run: ${r.lines.join(' | ')} / ${r.error}`);
r = await run({});
expect(/APP_URL is not set/.test(r.error ?? '') && !r.lines.length, `no APP_URL fails the run before any fetch: ${r.error}`);
const toml = fs.readFileSync(`${project}/worker/wrangler.toml`, 'utf8');
expect(/^crons = \["\* \* \* \* \*"\]$/m.test(toml) && /^main = "worker\.js"$/m.test(toml), 'wrangler.toml runs worker.js on cron * * * * *');
expect(!/token|secret|key/i.test(toml + fs.readFileSync(`${project}/worker/worker.js`, 'utf8')), 'the worker holds no secret');
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
