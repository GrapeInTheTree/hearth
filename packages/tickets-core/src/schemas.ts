import { z } from 'zod';

import { SnowflakeSchema } from './lib/snowflake.js';

// Validation schemas shared between forms (dashboard) and slash command
// option parsers (bot). Keep field constraints in this single file so
// invariants don't drift between input surfaces.

const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'] as const;

/**
 * `/panel create` (or dashboard "New panel" form) input.
 * embedTitle / embedDescription fall back to i18n defaults when omitted.
 */
export const PanelInputSchema = z.object({
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  embedTitle: z.string().min(1).max(256).optional(),
  embedDescription: z.string().min(1).max(4000).optional(),
});
export type PanelInput = z.infer<typeof PanelInputSchema>;

/**
 * `/panel ticket-type add` (or dashboard "New ticket type" form) input.
 * `name` is the stable lookup key; `label` is what users see on the button.
 */
export const TicketTypeInputSchema = z.object({
  panelId: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9-]+$/, 'name must be lowercase letters, digits, or hyphens'),
  label: z.string().min(1).max(80),
  emoji: z.string().max(64),
  buttonStyle: z.enum(BUTTON_STYLES).optional(),
  buttonOrder: z.number().int().min(0).max(24).optional(),
  activeCategoryId: SnowflakeSchema,
  supportRoleIds: z.array(SnowflakeSchema).max(20),
  pingRoleIds: z.array(SnowflakeSchema).max(20),
  perUserLimit: z.number().int().min(1).max(20).nullable(),
  welcomeMessage: z.string().min(1).max(4000).optional(),
});
export type TicketTypeInput = z.infer<typeof TicketTypeInputSchema>;

/**
 * `/setup` (or dashboard "Settings" form) input.
 */
export const GuildConfigInputSchema = z.object({
  guildId: SnowflakeSchema,
  archiveCategoryId: SnowflakeSchema.nullable().optional(),
  alertChannelId: SnowflakeSchema.nullable().optional(),
});
export type GuildConfigInput = z.infer<typeof GuildConfigInputSchema>;
