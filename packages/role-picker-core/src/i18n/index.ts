import { rolePicker as enRolePicker, type RolePickerBundle } from './en.js';

export type { RolePickerBundle };

/**
 * The current role-picker-domain copy bundle. Single English locale today;
 * pass a different bundle to services via constructor to localize. Mirrors
 * @hearth/tickets-core/i18n shape.
 */
export const rolePicker: RolePickerBundle = enRolePicker;
