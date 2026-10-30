# Across

P2P browser file transfer, live at https://acrossfile.com (Vercel project `cameronspears-projects/across`; the old file-transfer-tan-alpha.vercel.app still serves it). README.md explains how it works; decisions.tsv logs past design decisions, so add a row for new ones.

## Layout
- `public/index.html`: the whole UI (HTML, CSS, JS in one file).
- `api/`: Vercel functions (`signal`, `ice`, `guard`). `lib/`: shared server code; `lib/headers.js` builds the CSP.
- `vercel.ts`: config (headers, www → apex redirect). `worker/`: Cloudflare cron that pings `/api/guard`.
- `test/`: puppeteer-core and shell tests.

## Rules
- Strict CSP: `default-src 'none'`, script and style allowed by hash of the inline blocks. No inline `style` attributes (use `el.style` in JS), no webfonts, images only as `data:`.
- Light theme only, black and white. One dark action per screen; check the page still reads when blurred.
- Never print `.env.local` values.
- Production deploys need the owner's OK. Always run them from the repo root: `vercel deploy --prod --yes`. Then check `curl -s https://acrossfile.com/ | shasum` matches `shasum public/index.html`.
- Vercel Hobby plan: non-commercial use only.

## Run and test
- `sh test/servers.sh` starts the dev servers (http://localhost:8090, 8092, 8093) and local coturn relays. Restart after editing `index.html` (the dev server reads it at startup).
- Main tests, run from `test/`: `node ui.mjs`, `node photos.mjs http://localhost:8090`, `node evil-sender.mjs`, `node zip-evil.mjs`, `node link.mjs`, `node engines.mjs`, `sh matrix.sh <base> <file>`. Use `BASE=https://acrossfile.com node ui.mjs` for the live site; leave a few seconds between live runs (relay rate limit).
- `matrix.sh` has one known failure (sender shown, receiver hidden, no `.local` names) that predates the redesign.
- Stop servers and test browsers when done (`pkill -f 'node.*dev.mjs'; pkill -f turnserver`). The Mac has 16 GB of RAM.
