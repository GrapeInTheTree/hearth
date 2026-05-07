import { verification as enVerification, type VerificationBundle } from './en.js';

export type { VerificationBundle };

/**
 * The current verification-domain copy bundle. Single English locale
 * shipped today; pass a different bundle to services via constructor
 * to localize. Mirrors @hearth/tickets-core/i18n shape.
 */
export const verification: VerificationBundle = enVerification;
