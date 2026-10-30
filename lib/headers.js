import { createHash } from 'node:crypto';

const hashes = (pages, tag) =>
  pages.flatMap((html) => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))]
    .map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`))
    .join(' ');

// Header rules in vercel.json's shape. vercel.ts and dev.mjs both call this
// with every page they ship, so local and production send the same CSP.
// One policy allows each page's own inline blocks and nothing else.
export function headerRules(...pages) {
  const csp = [
    "default-src 'none'",
    `script-src ${hashes(pages, 'script') || "'none'"}`,
    `style-src ${hashes(pages, 'style')}`,
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'self'",
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  const noCache = [{ key: 'Cache-Control', value: 'no-cache' }];
  return [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      ],
    },
    { source: '/', headers: noCache },
    { source: '/sw.js', headers: noCache },
  ];
}
