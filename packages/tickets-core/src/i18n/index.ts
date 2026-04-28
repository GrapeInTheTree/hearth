import { tickets as enTickets, type TicketsBundle } from './en.js';

export type { TicketsBundle };

/**
 * Substitute `{var}` placeholders in a template string.
 * Unknown keys are left untouched (visible as `{key}`) for easy detection.
 */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * The current ticket-domain copy bundle. Single English locale shipped today;
 * pass a different bundle to services via the `tickets` constructor parameter
 * to localize.
 */
export const tickets: TicketsBundle = enTickets;
