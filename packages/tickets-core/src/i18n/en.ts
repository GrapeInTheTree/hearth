// Ticket-related copy. Phase 1 implements; Phase 0 includes for contract documentation.
// All variables: {channel_name}, {ticket_number}, {type_emoji}, {type_name},
//   {opener_mention}, {opener_emojis}, {closer_mention}, {closer_emojis}, {actor_mention}.

export const tickets = {
  panel: {
    // Defaults used when /panel create is invoked without title/description
    // options. Operators are encouraged to provide their own copy via the
    // slash command — these strings are intentionally generic so a fresh
    // deployment is recognizable as "needs configuration".
    defaultEmbedTitle: 'Contact Team',
    defaultEmbedDescription: 'Click a button below to open a ticket.',
  },

  channelHeader: {
    open: 'This is the start of the #{channel_name} **private** channel.\nTicket #{ticket_number} - Type: {type_emoji} **{type_name}** - Created by: {opener_mention} {opener_emojis}',
    closed:
      'This is the start of the #{channel_name} **private** channel.\nTicket #{ticket_number} - Type: {type_emoji} **{type_name}** - Closed by: {closer_mention} - Created by: {opener_mention} {opener_emojis}',
  },

  welcome: {
    default:
      'Your ticket has been successfully created.\n\nTo help us assist you more efficiently:\n1. Please share any details you feel are relevant to your proposal or application.\n2. The more specific information you provide, the better we can understand and respond to your offer.\n\nWhile we love the spicy enthusiasm, we may not be able to respond to very general questions like "Are you interested?" without additional context.\n\nWe\'re looking forward to learning more about your offer.',
  },

  buttons: {
    claim: 'Claim',
    claimedBy: 'Claimed by {user}',
    close: 'Close',
    reopen: 'Reopen',
    delete: 'Delete',
  },

  closeMessage: '{closer_mention} {closer_emojis} closed the ticket.',
  reopenMessage: '{actor_mention} reopened the ticket.',
  claimMessage: '{actor_mention} claimed the ticket.',

  openSuccess: 'Your ticket has been opened: {channel}',

  errors: {
    alreadyOpen: 'You already have an open ticket of this type. Please use that one.',
    alreadyClaimed: 'This ticket is already claimed.',
    alreadyClosed: 'This ticket is already closed.',
    notClosed: 'Only closed tickets can be reopened.',
    creating: 'Another ticket is being created right now. Please try again in a moment.',
    categoryFull: 'The support category is full. Please contact an admin.',
    notSupportStaff: 'Only support staff can perform this action.',
    notAdmin: 'Only administrators can delete tickets.',
    notTicketChannel: 'This command can only be used inside a ticket channel.',
    panelMissing: 'This panel is no longer available. Please contact an admin.',
    notConfigured:
      'The bot is not yet configured for tickets. An administrator must run /setup first.',
  },
} as const;

export type TicketsBundle = typeof tickets;
