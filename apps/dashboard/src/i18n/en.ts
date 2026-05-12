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
    panels: 'Ticket Panels',
    tickets: 'Tickets',
    verification: 'Verification',
    reactionRoles: 'Self-roles',
    rolePicker: 'Role picker',
    settings: 'Settings',
    sectionWorkspace: 'Workspace',
    sectionAccount: 'Account',
  },
  overview: {
    title: 'Overview',
    description: 'A quick glance at this server.',
    counts: {
      ticketPanels: 'Ticket panels',
      openTickets: 'Active tickets',
      closedTickets: 'Closed tickets',
      verificationPanels: 'Verification panels',
      verifiedUsers: 'Verified users',
      reactionRolesPanels: 'Self-roles panels',
      reactionRolesActiveHolders: 'Self-role users',
    },
    sections: {
      activity: 'Recent activity',
      activityEmpty: 'No activity yet — events show up here as they happen.',
      quickStart: 'Get started',
      quickStartHint:
        'Empty server. Spin up your first ticket panel or verification gate to start tracking activity.',
    },
    activity: {
      ticketOpened: 'Ticket #{number} opened',
      ticketClaimed: 'Ticket #{number} claimed',
      ticketClosed: 'Ticket #{number} closed',
      ticketReopened: 'Ticket #{number} reopened',
      ticketDeleted: 'Ticket #{number} deleted',
      ticketChannelDeleted: 'Ticket #{number} channel removed externally',
      verificationSuccess: 'New verified member',
      verificationWrong: 'Wrong answer attempt',
      verificationAlready: 'Re-clicked (already verified)',
      verificationFailed: 'Role assign failed',
      reactionRolesGranted: 'Self-role granted',
      reactionRolesRevoked: 'Self-role revoked',
      reactionRolesNoop: 'Self-role op rejected by Discord',
    },
    quickActions: {
      newTicketPanel: 'New ticket panel',
      newVerificationPanel: 'New verification panel',
      viewTickets: 'View tickets',
      viewSettings: 'Settings',
    },
  },
  permissions: {
    forbiddenTitle: 'Permission denied',
    forbiddenBody: 'You need the Manage Server permission to access this server.',
  },
} as const;

export type Bundle = typeof en;
