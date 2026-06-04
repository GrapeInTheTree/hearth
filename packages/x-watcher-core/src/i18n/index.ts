import { xWatcher as enXWatcher, type XWatcherBundle } from './en.js';

export type { XWatcherBundle };

/**
 * The current x-watcher-domain copy bundle. Single English locale today;
 * pass a different bundle to services to localise. Mirrors
 * @hearth/tickets-core/i18n shape.
 */
export const xWatcher: XWatcherBundle = enXWatcher;
