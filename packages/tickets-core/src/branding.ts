/**
 * Brand identity injected into ticket-domain rendering. The bot reads this
 * from env (apps/bot/src/config/branding.ts); the dashboard reads the same
 * env keys (apps/dashboard/src/config/branding.ts). Either passes a frozen
 * Branding object into the service constructors so tickets-core never
 * touches process.env directly.
 *
 * `color` is a Discord-compatible 24-bit RGB integer (e.g. 0x5865F2).
 */
export interface Branding {
  readonly name: string;
  readonly color: number;
  readonly iconUrl: string | undefined;
  readonly footerText: string | undefined;
  readonly supportUrl: string | undefined;
  readonly locale: 'en' | 'ko';
}
