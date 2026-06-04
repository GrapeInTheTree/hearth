// X-watcher domain copy. Operator-facing form/slash errors plus the
// dashboard chrome strings for the feature. End users never see any of
// these — the bot only ever posts a bare link — so this bundle is
// operator-only.

export const xWatcher = {
  errors: {
    watcherNotFound: 'Watcher not found.',
    duplicateWatcher: 'This account is already mirrored into this channel.',
    invalidHandle:
      'Enter a valid X handle — letters, digits, and underscores only (the @ is optional).',
  },
} as const;

export type XWatcherBundle = typeof xWatcher;
