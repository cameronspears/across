// node [--env-file=.env.local] empty-store.mjs <project> <env|redis://...>: deletes every relay:* key, so the next
// budget run starts from an empty guard state. Refuses when relay:creds holds a credential the stub did not mint,
// because untracking a real credential would leave it unrevokable.
const [project, store] = process.argv.slice(2);
const { createClient } = await import(`${project}/node_modules/redis/dist/index.js`);
const redis = await createClient({ url: store === 'env' ? process.env.REDIS_URL : store, disableClientInfo: true }).connect();
const creds = await redis.zRange('relay:creds', 0, -1);
if (!creds.every((u) => /^\d+:[0-9a-f]{24}$/.test(u))) {
  console.error(`relay:creds holds ${creds.length} credentials, not all from the stub; not emptying`);
  process.exit(2);
}
const keys = await redis.keys('relay:*');
if (keys.length) await redis.del(keys);
console.log(`emptied ${keys.length} relay:* keys; ${(await redis.keys('relay:*')).length} left`);
await redis.quit();
