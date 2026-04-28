// Operator-facing dashboard copy. Tickets domain copy lives in
// @hearth/tickets-core (shared with the bot's slash error responses);
// keep this bundle to UI chrome — buttons, labels, page titles, empty
// states.

export const en = {
  app: {
    signIn: 'Sign in with Discord',
    signOut: 'Sign out',
    loading: 'Loading…',
    notFound: 'Not found',
    unknownError: 'Something went wrong. Please try again.',
  },
  guildPicker: {
    title: 'Choose a server',
    description: 'Servers where you have Manage Server permission and the bot is present.',
    empty: 'No servers available. Invite the bot to a server first.',
    inviteCta: 'Invite the bot',
  },
  nav: {
    overview: 'Overview',
    panels: 'Panels',
    tickets: 'Tickets',
    settings: 'Settings',
  },
  overview: {
    title: 'Overview',
    counts: {
      panels: 'Panels',
      openTickets: 'Open tickets',
      closedTickets: 'Closed tickets',
    },
    quickActions: {
      newPanel: 'New panel',
      viewTickets: 'View tickets',
    },
  },
  permissions: {
    forbiddenTitle: 'Permission denied',
    forbiddenBody: 'You need the Manage Server permission to access this server.',
  },
} as const;

export type Bundle = typeof en;
