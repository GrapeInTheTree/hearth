// Role-picker domain copy. Operator-facing form errors and the embed
// defaults share this bundle so a single translation pass covers all
// surfaces. End-users see ephemeral confirms in Discord per submission
// — those strings live here too so localisation stays uniform.

export const rolePicker = {
  panel: {
    // Defaults shown when /rolepicker create runs without title/description.
    defaultEmbedTitle: 'Pick your role',
    defaultEmbedDescription: 'Open the dropdown below and pick the option you want.',
    /** Dropdown chrome shown when the user has nothing selected yet. */
    defaultPlaceholder: 'Pick a role…',
  },

  optionLine: '{emoji} **{label}** — <@&{roleId}>',

  ephemeral: {
    grantedOnly: 'Added: {labels}.',
    revokedOnly: 'Removed: {labels}.',
    grantedAndRevoked: 'Updated. Removed: {removed}. Added: {added}.',
    noopAllFailed:
      'Your role could not be updated — the bot is missing permissions or its role is below the target role. Please contact a server administrator.',
    failedPartial:
      'Your role was partially updated; some changes failed. Please contact a server administrator.',
    noChange: 'No change.',
  },

  errors: {
    panelNotFound: 'Role-picker panel not found.',
    optionNotFound: 'Option not found on this role-picker panel.',
    optionLimitReached: 'A role-picker panel can have at most 25 options.',
    optionsRequired:
      'Add at least one option before publishing the panel — empty dropdowns are rejected by Discord.',
    duplicateLabel: 'An option with this label already exists on this panel.',
    duplicateRole: 'An option binding this role already exists on this panel.',
    duplicatePosition: 'An option already exists at this position.',
    invalidEmoji: 'Emoji must be a Unicode character or a Discord custom emoji reference.',
    invalidPosition: 'Position must be between 0 and 24.',
    invalidSelectionRange:
      'Selection range invalid — min and max values must each be between 0 and 25, and min must not exceed max.',
    unknownSelection: 'One or more selected options no longer exist on this panel.',
  },
} as const;

export type RolePickerBundle = typeof rolePicker;
