// Turns a stream of chunks posted from the page into a normal browser download,
// so the receiver writes to disk as bytes arrive instead of buffering in memory.

const pending = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'register') return; // pings just keep us awake
  const port = e.ports[0];
  const stream = new ReadableStream({
    start(controller) {
      port.onmessage = ({ data }) => {
        if (data === 'end') controller.close();
        else if (data === 'abort') controller.error(new Error('transfer aborted'));
        else controller.enqueue(new Uint8Array(data));
      };
    },
    cancel() {
      port.postMessage('cancel');
    },
  });
  pending.set(msg.id, { stream, name: msg.name, size: msg.size });
  port.postMessage('ready');
});

self.addEventListener('fetch', (e) => {
  const m = new URL(e.request.url).pathname.match(/\/dl\/([a-z0-9]+)\//);
  const entry = m && pending.get(m[1]);
  if (!entry) return;
  pending.delete(m[1]);
  e.respondWith(new Response(entry.stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(entry.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
    },
  }));
});
