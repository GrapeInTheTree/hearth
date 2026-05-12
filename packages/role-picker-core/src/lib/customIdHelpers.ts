import { encode } from '@hearth/tickets-core';

// Encode the StringSelectMenu's customId at panel-create time so the
// value is stored on the row and reused on every render. Discord caps
// the customId at 100 chars; this encoding is `role-picker:submit|{"panelId":"<cuid2>"}`
// which is well under the budget (action 18 + separator 1 + cuid 25 + JSON wrap 14 ≈ 58).
//
// Selected option ids are NOT part of the customId — they arrive at
// runtime in `interaction.values[]`. This keeps the customId stable
// across edits even when options are added or removed.

export function buildRolePickerCustomId(panelId: string): string {
  return encode('role-picker:submit', { panelId });
}
