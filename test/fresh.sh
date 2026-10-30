#!/bin/sh
# sh fresh.sh <project> <memory|local|env> <runs> [stubPort] [redisPort] [script]: runs budget.mjs (or script)
# <runs> times, each on a newly started Cloudflare stub and an empty store. local starts a new redis-server on
# redisPort; env empties relay:* on the Upstash in .env.local. Distinct ports let lanes run side by side.
E=$(cd "$(dirname "$0")" && pwd); P=$1; B=$2; N=$3; SP=${4:-8099}; RP=${5:-6390}; T=${6:-budget.mjs}
stop() { lsof -ti tcp:$1 -sTCP:LISTEN | xargs kill 2>/dev/null; while lsof -ti tcp:$1 -sTCP:LISTEN >/dev/null; do sleep 0.1; done; }
export STUB_URL=http://127.0.0.1:$SP
pass=0
for i in $(seq 1 "$N"); do
  stop "$SP"
  (PORT=$SP node "$E/cf-stub.mjs" > "$E/stub$SP.log" 2>&1 &)
  if [ "$B" = local ]; then stop "$RP"; (redis-server --port "$RP" --save '' --appendonly no > "$E/redis$RP.log" 2>&1 &); fi
  until lsof -ti tcp:$SP -sTCP:LISTEN >/dev/null && { [ "$B" != local ] || redis-cli -p "$RP" ping >/dev/null 2>&1; }; do sleep 0.1; done
  case $B in
    memory) out=$(node "$E/$T" "$P" memory 2>&1) ;;
    local) echo "   redis $RP keys before run $i: $(redis-cli -p "$RP" dbsize)"; out=$(node "$E/$T" "$P" "redis://127.0.0.1:$RP" 2>&1) ;;
    env) node --env-file="$P/.env.local" "$E/empty-store.mjs" "$P" env | sed 's/^/   /' || exit 2
      out=$(node --env-file="$P/.env.local" "$E/$T" "$P" env 2>&1) ;;
  esac
  code=$?
  echo "== $T run $i ($B): exit $code"
  echo "$out" | sed 's/^/   /'
  [ $code -eq 0 ] && pass=$((pass + 1))
done
stop "$SP"
[ "$B" = local ] && stop "$RP"
echo "$T on $B: $pass of $N runs passed"
[ $pass -eq "$N" ]
