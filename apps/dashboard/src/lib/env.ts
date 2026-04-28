import { SnowflakeSchema } from '@hearth/tickets-core';
import { z } from 'zod';

// Server-side env. Imported only from server components, route handlers,
// Server Actions, and lib/. Never imported by client components — Next.js
// would refuse to bundle process.env.X anyway, but the typed export here
// is the single source of truth so we don't read process.env elsewhere.

const EnvSchema = z.object({
  // Discord OAuth — required
  DISCORD_CLIENT_ID: SnowflakeSchema,
  DISCORD_CLIENT_SECRET: z.string().min(20, 'Discord client secret looks invalid'),

  // NextAuth — required
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32, 'NEXTAUTH_SECRET must be at least 32 characters'),

  // Database — same as bot
  DATABASE_URL: z.string().url(),

  // Bot internal API
  BOT_INTERNAL_URL: z.string().url(),
  INTERNAL_API_TOKEN: z.string().min(32, 'INTERNAL_API_TOKEN must be at least 32 characters'),

  // Branding (mirror bot)
  BOT_NAME: z.string().min(1).max(32),
  BOT_BRAND_COLOR: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'BOT_BRAND_COLOR must be hex like #RRGGBB')
    .default('#5865F2'),
  BOT_ICON_URL: z.string().url().optional(),
  BOT_FOOTER_TEXT: z.string().max(2048).optional(),
  BOT_SUPPORT_URL: z.string().url().optional(),
  BOT_LOCALE: z.enum(['en', 'ko']).default('en'),

  // Optional
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SENTRY_DSN: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().max(65535).default(3200),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(source).map(([k, v]) => [k, v === '' ? undefined : v]),
  );
  const parsed = EnvSchema.safeParse(cleaned);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`❌ Invalid environment:\n${issues}\n`);
    console.error('See apps/dashboard/.env.example for the full list of variables.');
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = loadEnv();
