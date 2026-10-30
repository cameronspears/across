#!/bin/sh
# sh test/zipbench.sh <baseUrl> <runs> <file>...: hidden transfers with compression off and on, alternating.
T=$(cd "$(dirname "$0")" && pwd); B=$1; N=$2; shift 2
for f in "$@"; do
  for i in $(seq 1 "$N"); do
    for z in 0 1; do
      line=$(ZIP=$z node "$T/link.mjs" "$B" 1 1 "$f" main 1 2>&1 | grep -E "^ready|PASS|FAIL" | tr '\n' ' ')
      echo "$(basename "$f") zip=$z run=$i $line"
    done
  done
done
