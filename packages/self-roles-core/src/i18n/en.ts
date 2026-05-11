// Self-roles domain copy. Operator-facing form errors and the embed
// defaults share this bundle so a single translation pass covers all
// surfaces. End-users see no per-click feedback (reactions are silent by
// design) — the embed itself describes the available options.

export const selfRoles = {
  panel: {
    // Defaults shown when /selfroles create runs without title/description.
    defaultEmbedTitle: 'Select your roles',
    defaultEmbedDescription:
      'React to this message with the emoji that matches a role you want. Remove your reaction to give the role back.',
  },

  optionLine: '{emoji} **{label}** — <@&{roleId}>',

  errors: {
    panelNotFound: 'Self-roles panel not found.',
    optionNotFound: 'Option not found on this self-roles panel.',
    optionLimitReached: 'A self-roles panel can have at most 20 options.',
    duplicateLabel: 'An option with this label already exists on this panel.',
    duplicateEmoji: 'An option with this emoji already exists on this panel.',
    duplicatePosition: 'An option already exists at this position.',
    invalidEmoji: 'Emoji must be a Unicode character or a Discord custom emoji reference.',
    invalidPosition: 'Position must be between 0 and 9.',
  },
} as const;

export type SelfRolesBundle = typeof selfRoles;
