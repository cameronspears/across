// node config-check.mjs <projectDir> <devBaseUrl>
// Evaluates vercel.ts the way `node --experimental-strip-types` does and the way the Vercel CLI does
// (esbuild bundle into .vercel/vercel-temp.mjs, then import), and checks both against what dev.mjs serves
// and against script/style hashes computed independently in Python.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [project, devBase] = process.argv.slice(2);
const esbuild = await import(`${execFileSync('npm', ['root', '-g']).toString().trim()}/vercel/node_modules/esbuild/lib/main.js`);
const csp = (config) => config.headers.flatMap((r) => r.headers).find((h) => h.key === 'Content-Security-Policy').value;
let failures = 0;
const check = (name, ok, detail = '') => { failures += !ok; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && `\n     ${detail}`}`); };

const stripped = JSON.parse(execFileSync('node', ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e',
  "const { config } = await import('./vercel.ts'); console.log(JSON.stringify(config))"], { cwd: project }).toString());

const copy = fs.mkdtempSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'vercel-copy-'));
for (const f of ['vercel.ts', 'index.html', 'sw.js', 'package.json', 'lib', 'api']) fs.cpSync(path.join(project, f), path.join(copy, f), { recursive: true });
fs.symlinkSync(path.join(project, 'node_modules'), path.join(copy, 'node_modules'));
const out = path.join(copy, '.vercel', 'vercel-temp.mjs');
await esbuild.build({ entryPoints: [path.join(copy, 'vercel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, packages: 'external', target: 'node20', logLevel: 'silent' });
const cwd = process.cwd();
process.chdir(copy);
const mod = await import(pathToFileURL(out).href);
process.chdir(cwd);
const bundled = 'default' in mod ? mod.default : mod.config;
fs.rmSync(copy, { recursive: true, force: true });

const served = (await fetch(devBase)).headers.get('content-security-policy');
const py = execFileSync('python3', ['-I', '-c', `
import hashlib, base64, re, sys
html = open(sys.argv[1], encoding='utf-8').read()
for tag in ('script', 'style'):
    for body in re.findall('<%s>(.*?)</%s>' % (tag, tag), html, re.S):
        print(tag, "'sha256-" + base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode() + "'")
`, path.join(project, 'index.html')]).toString().trim().split('\n').map((l) => l.split(' '));

console.log('vercel.ts (strip-types) config:', JSON.stringify({ ...stripped, headers: `${stripped.headers.length} rules` }));
console.log('CSP:', csp(stripped));
check('strip-types and Vercel-CLI-style bundle produce identical config', JSON.stringify(stripped) === JSON.stringify(bundled));
check('dev.mjs serves the same CSP as vercel.ts', served === csp(stripped), served);
for (const [tag, hash] of py) check(`${tag}-src carries the Python-computed hash ${hash}`, csp(stripped).includes(`${tag}-src ${hash}`));
check('functions: api/signal.js maxDuration 30', stripped.functions?.['api/signal.js']?.maxDuration === 30);
check('cleanUrls on', stripped.cleanUrls === true);
const rule = (src) => stripped.headers.find((r) => r.source === src)?.headers.map((h) => `${h.key}: ${h.value}`) ?? [];
check('no-cache on / and /sw.js', rule('/').includes('Cache-Control: no-cache') && rule('/sw.js').includes('Cache-Control: no-cache'));
console.log(rule('/(.*)').map((h) => '  ' + h).join('\n'));
process.exit(failures ? 1 : 0);
