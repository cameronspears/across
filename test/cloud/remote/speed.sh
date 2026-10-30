#!/bin/bash
# Raw capacity: Cloudflare speed test down/up, 1 and 4 streams, and TCP connect time to the TURN host.
set -uo pipefail
cd /vercel/sandbox
D=50000000; U=25000000
[ -s up.bin ] || head -c $U /dev/urandom > up.bin
down1=$(curl -s -o /dev/null -w '%{speed_download}' "https://speed.cloudflare.com/__down?bytes=$D")
t0=$(date +%s.%N); for i in 1 2 3 4; do curl -s -o /dev/null "https://speed.cloudflare.com/__down?bytes=$D" & done; wait; t1=$(date +%s.%N)
up1=$(curl -s -o /dev/null -w '%{speed_upload}' --data-binary @up.bin https://speed.cloudflare.com/__up)
t2=$(date +%s.%N); for i in 1 2 3 4; do curl -s -o /dev/null --data-binary @up.bin https://speed.cloudflare.com/__up & done; wait; t3=$(date +%s.%N)
node -e '
const [d1,t0,t1,u1,t2,t3]=process.argv.slice(1).map(Number), d4=t1-t0, u4=t3-t2;
console.log(JSON.stringify({down1MBps:d1/1e6, down4MBps:4*'$D'/1e6/d4, up1MBps:u1/1e6, up4MBps:4*'$U'/1e6/u4}))' \
  "$down1" "$t0" "$t1" "$up1" "$t2" "$t3"
node -e '
const net=require("net");
const one=(port)=>new Promise(ok=>{const t=process.hrtime.bigint();const s=net.connect(port,"turn.cloudflare.com",()=>{ok(Number(process.hrtime.bigint()-t)/1e6);s.destroy()});s.on("error",()=>ok(NaN))});
(async()=>{const out={};for(const p of [3478,443]){const v=[];for(let i=0;i<10;i++)v.push(await one(p));v.sort((a,b)=>a-b);out["connectMs"+p]=[v[0],v[5],v[9]].map(x=>+x.toFixed(2))}
require("dns").lookup("turn.cloudflare.com",{all:true},(e,a)=>{out.turnAddrs=a?.map(x=>x.address);console.log(JSON.stringify(out))})})()'
