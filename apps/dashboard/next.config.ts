import type { NextConfig } from 'next';

// `transpilePackages` is required so Next.js compiles our workspace TS
// packages on the fly — they ship as raw TS or as ESM dist that Next still
// needs to walk for tree-shaking.
//
// `serverExternalPackages` keeps @hearth/database (and downstream
// tickets-core, since it imports TicketStatus + Prisma) off the client
// bundle — these are server-only Node.js modules that pull node:path/fs
// via Prisma's driver-adapter chain, which Webpack can't bundle.
//
// `output: 'standalone'` produces a self-contained Node bundle for the
// Docker runtime image (PR-7).
const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@hearth/shared'],
  serverExternalPackages: [
    '@hearth/database',
    '@hearth/tickets-core',
    '@prisma/client',
    '@prisma/adapter-pg',
  ],
  reactStrictMode: true,
  // Lint runs in the workspace pipeline (`pnpm lint`). Skipping it during
  // `next build` avoids duplicate work and lets us own the rule config in
  // packages/eslint-config rather than fighting eslint-config-next defaults.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Server Actions: explicitly limit body size. Default 1 MB, but keep
    // tight to discourage operators from stuffing files into forms before
    // a proper upload flow lands.
    serverActions: {
      bodySizeLimit: '512kb',
    },
  },
};

export default nextConfig;
