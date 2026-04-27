import { defineConfig } from 'tsup';

export default defineConfig({
  // Multi-entry: every src/**/*.ts becomes its own dist/**/*.js.
  // Required because Sapphire scans dist/{commands,listeners,interactions,...}/
  // for piece files at runtime — bundling everything into a single file would
  // hide pieces from the loader.
  entry: ['src/**/*.ts', '!src/**/*.test.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: false,
  splitting: false,
  // Everything 3rd-party stays external so Node resolves it from
  // node_modules at runtime. Workspace packages are also external —
  // `pnpm deploy --prod --legacy` flattens them under node_modules/@discord-bot/*
  // along with their transitive deps (Prisma, pg, …). Inlining workspace
  // packages would force apps/bot to redeclare every transitive dep,
  // eroding the package boundary documented in CLAUDE.md §3.
  external: [
    /^@discord-bot\//,
    /^@prisma\//,
    'discord.js',
    'pg',
    'pg-native',
    /^@sapphire\//,
    'zod',
  ],
});
