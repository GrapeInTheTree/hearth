// Verification-domain copy. Operator-facing form errors and end-user-facing
// outcome messages share this bundle so a single translation pass covers
// both surfaces. All strings are intentionally generic — server admins
// override the panel embed via /verification create or the dashboard.

export const verification = {
  panel: {
    // Defaults shown when /verification create is run without title/description.
    defaultEmbedTitle: 'Verification',
    defaultEmbedDescription: 'Click the correct option below to receive your verification role.',
  },

  outcomes: {
    // Returned to the user as ephemeral replies after a button click.
    success: '✅ Verified! Your role has been granted.',
    wrongAnswer: "❌ That's not right. Please try again.",
    alreadyVerified: 'You already have the verification role.',
    roleAssignFailed: 'I could not assign your role. Please contact a server administrator.',
  },

  errors: {
    panelNotFound: 'Verification panel not found.',
    optionNotFound: 'Option not found on this verification panel.',
    optionLimitReached: 'A verification panel can have at most 5 options.',
    cannotRemoveCorrect: 'Set a different correct option before removing the current one.',
    correctOptionNotSet: 'Set a correct option before publishing this verification panel.',
    duplicateLabel: 'An option with this label already exists on this panel.',
    duplicatePosition: 'An option already exists at this button position.',
    invalidEmoji: 'Emoji must be a Unicode character or a Discord custom emoji reference.',
    invalidPosition: 'Button position must be between 0 and 4.',
    invalidButtonStyle: 'Button style must be primary, secondary, success, or danger.',
    optionFromOtherPanel: 'That option does not belong to the given panel.',
  },
} as const;

export type VerificationBundle = typeof verification;
