import { reactionRoles as enReactionRoles, type ReactionRolesBundle } from './en.js';

export type { ReactionRolesBundle };

/**
 * The current reaction-roles-domain copy bundle. Single English locale today;
 * pass a different bundle to services via constructor to localize. Mirrors
 * @hearth/tickets-core/i18n shape.
 */
export const reactionRoles: ReactionRolesBundle = enReactionRoles;
