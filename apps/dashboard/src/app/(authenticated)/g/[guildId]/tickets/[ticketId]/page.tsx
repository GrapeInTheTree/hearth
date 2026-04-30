import { asc, dbDrizzle, eq, schema } from '@hearth/database';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import { relativeTime } from '@/lib/format';

interface ResolveResponse {
  readonly users: Record<string, { username: string; avatarHash: string | null }>;
  readonly channels: Record<string, { name: string }>;
}

interface TicketDetailPageProps {
  readonly params: Promise<{ readonly guildId: string; readonly ticketId: string }>;
}

interface FieldRow {
  readonly label: string;
  readonly value: React.ReactNode;
}

export default async function TicketDetailPage({
  params,
}: TicketDetailPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId, ticketId } = await params;
  const ticket = await dbDrizzle.query.ticket.findFirst({
    where: eq(schema.ticket.id, ticketId),
    with: {
      panel: { columns: { id: true, embedTitle: true } },
      panelType: { columns: { id: true, name: true, emoji: true, buttonLabel: true } },
      events: { orderBy: asc(schema.ticketEvent.createdAt) },
    },
  });
  if (ticket === undefined || ticket.guildId !== guildId) notFound();

  // Resolve all snowflakes appearing on this page (opener, claimer,
  // channel, every event actor) to display names in one batch call. Bot
  // cache misses fall back to raw IDs.
  const userIds = new Set<string>([ticket.openerId]);
  if (ticket.claimedById !== null) userIds.add(ticket.claimedById);
  for (const e of ticket.events) userIds.add(e.actorId);
  const resolved = await callBot<ResolveResponse>({
    path: '/internal/resolve',
    method: 'POST',
    body: { userIds: Array.from(userIds), channelIds: [ticket.channelId] },
  });
  const userMap = resolved.ok ? resolved.value.users : {};
  const channelMap = resolved.ok ? resolved.value.channels : {};
  const formatUser = (id: string): React.ReactNode => {
    const u = userMap[id];
    return u !== undefined ? (
      <span>@{u.username}</span>
    ) : (
      <code className="font-mono text-xs">{id}</code>
    );
  };
  const channelInfo = channelMap[ticket.channelId];

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  const fields: FieldRow[] = [
    { label: 'Number', value: `#${String(ticket.number)}` },
    {
      label: 'Type',
      value: (
        <span className="inline-flex items-center gap-1 font-mono text-xs">
          {ticket.panelType.emoji !== '' ? (
            <span aria-hidden="true">{ticket.panelType.emoji}</span>
          ) : null}
          {ticket.panelType.name}
        </span>
      ),
    },
    { label: 'Status', value: <span className="font-mono text-xs">{ticket.status}</span> },
    { label: 'Opener', value: formatUser(ticket.openerId) },
    {
      label: 'Claimed by',
      value:
        ticket.claimedById !== null ? (
          formatUser(ticket.claimedById)
        ) : (
          <span className="text-[color:var(--color-fg-muted)]">—</span>
        ),
    },
    {
      label: 'Channel',
      value:
        channelInfo !== undefined ? (
          <span className="font-mono text-xs">#{channelInfo.name}</span>
        ) : (
          <code className="font-mono text-xs">{ticket.channelId}</code>
        ),
    },
    { label: 'Opened', value: relativeTime(ticket.openedAt) },
    {
      label: 'Closed',
      value:
        ticket.closedAt !== null ? (
          relativeTime(ticket.closedAt)
        ) : (
          <span className="text-[color:var(--color-fg-muted)]">—</span>
        ),
    },
  ];

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title={`Ticket #${String(ticket.number)}`}
        description={`${ticket.panelType.buttonLabel ?? ticket.panelType.name} · ${ticket.panel.embedTitle}`}
      />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-8 py-12">
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 py-6 text-sm">
            {fields.map((f) => (
              <div key={f.label} className="flex flex-col gap-0.5">
                <span className="text-xs uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                  {f.label}
                </span>
                <span>{f.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event timeline</CardTitle>
            <CardDescription>
              Append-only log of every state change. Driven by the bot — the dashboard is read-only
              for tickets in this release.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ticket.events.length === 0 ? (
              <p className="text-sm text-[color:var(--color-fg-muted)]">No events yet.</p>
            ) : (
              <ol className="grid gap-3 border-l pl-4">
                {ticket.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span
                      className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: 'var(--color-accent)' }}
                      aria-hidden="true"
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{e.type}</span>
                      <span className="text-xs text-[color:var(--color-fg-muted)]">
                        {formatUser(e.actorId)} · {relativeTime(e.createdAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
