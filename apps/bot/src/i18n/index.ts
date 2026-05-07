import { tickets as enTickets, format } from '@hearth/tickets-core';
import { verification as enVerification } from '@hearth/verification-core';

import { branding } from '../config/branding.js';

import { common as enCommon } from './en/common.js';

// `tickets` is the canonical ticket-domain copy bundle, owned by
// @hearth/tickets-core so the dashboard can read identical strings.
// `verification` is the verification-domain bundle owned by
// @hearth/verification-core, same shape and reasoning. `common` is bot-
// specific (boot logs, generic command errors) and lives here. Locale
// switching is a no-op today (single 'en' bundle shipped) — the
// structure is preserved so adding a 'ko' bundle later is a translation
// PR, not a refactor.
const dictionaries = {
  en: { common: enCommon, tickets: enTickets, verification: enVerification },
  // ko: { common: koCommon, tickets: koTickets, verification: koVerification },
} as const;

type Dictionary = typeof dictionaries.en;

export const i18n: Dictionary = dictionaries[branding.locale === 'ko' ? 'en' : branding.locale];

export { format };
