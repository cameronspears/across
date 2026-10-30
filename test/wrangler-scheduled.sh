#!/bin/sh
# sh wrangler-scheduled.sh <project> <baseUrl>: runs worker/worker.js in wrangler dev (workerd, no login), fires its
# cron with /__scheduled, and passes when the worker logs the guard's 200 JSON. Miniflare downloads its request.cf
# data from workers.cloudflare.com on start; it calls no Cloudflare API.
E=$(cd "$(dirname "$0")" && pwd); P=$1; B=$2; LOG="$E/wrangler-dev.log"
cd "$P/worker" || exit 2
(WRANGLER_SEND_METRICS=false wrangler dev --test-scheduled --var "APP_URL:$B" --port 8787 > "$LOG" 2>&1 &)
for i in $(seq 1 60); do lsof -ti tcp:8787 -sTCP:LISTEN >/dev/null && break; sleep 0.5; done
curl -s "http://localhost:8787/__scheduled?cron=*+*+*+*+*"; echo
sleep 1
line=$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep '^guard ')
lsof -ti tcp:8787 -sTCP:LISTEN | xargs kill 2>/dev/null
for pid in $(pgrep -f 'wrangler dev --test-scheduled'); do kill "$pid"; done
rm -rf "$P/worker/.wrangler" "$P/worker/node_modules"
echo "worker logged: $line"
echo "$line" | grep -Eq '^guard 200 \{"state":"(open|closed|unknown)","usedGB":[^,]+,"budgetGB":[0-9.]+,"live":[0-9]+,"revoked":[0-9]+\}$' && echo PASS || { echo FAIL; exit 1; }
