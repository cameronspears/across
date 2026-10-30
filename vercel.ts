import { readFileSync } from 'node:fs';
import { type VercelConfig } from '@vercel/config/v1';
import { headerRules } from './lib/headers.js';

export const config: VercelConfig = {
  outputDirectory: 'public',
  cleanUrls: true,
  functions: {
    'api/signal.js': { maxDuration: 30 },
    'api/ice.js': { maxDuration: 10 },
    'api/guard.js': { maxDuration: 10 },
    'api/code.js': { maxDuration: 10 },
  },
  redirects: [
    { source: '/:path*', has: [{ type: 'host', value: 'www.acrossfile.com' }], destination: 'https://acrossfile.com/:path*', permanent: true },
  ],
  headers: headerRules(readFileSync('public/index.html', 'utf8')),
};
