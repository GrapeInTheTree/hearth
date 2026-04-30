import { and, dbDrizzle, desc, eq, inArray, schema, TicketStatus } from '@hearth/database';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

interface ResolveResponse {
  readonly users: Record<string, { username: string; avatarHash: string | null }>;
  readonly channels: Record<string, { name: string }>;
}

interface TicketsListPageProps {
  readonly params: Promise<{ readonly guildId: string }>;
  readonly searchParams: Promise<{ readonly status?: string }>;
}

const STATUS_FILTERS: readonly {
  value: string;
  label: string;
  /** Statuses to include — `null` means "all statuses". */
  statuses: readonly TicketStatus[] | null;
}[] = [
  { value: 'all', label: 'All', statuses: null },
  { value: 'open', label: 'Open', statuses: [TicketStatus.open, TicketStatus.claimed] },
  { value: 'closed', label: 'Closed', statuses: [TicketStatus.closed] },
];

export default async function TicketsListPage({
  params,
  searchParams,
}: TicketsListPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId } = await params;
  const { status: statusParam } = await searchParams;
  const matchedFilter = STATUS_FILTERS.find((s) => s.value === statusParam);
  const filter = matchedFilter ?? STATUS_FILTERS[0];
  if (filter === undefined) throw new Error('STATUS_FILTERS empty — invariant');

  const statusClause =
    filter.statuses === null ? undefined : inArray(schema.ticket.status, [...filter.statuses]);
  const tickets = await dbDrizzle.query.ticket.findMany({
    where: and(eq(schema.ticket.guildId, guildId), statusClause),
    with: { panelType: { columns: { name: true, emoji: true } } },
    orderBy: desc(schema.ticket.openedAt),
    limit: 50,
  });

  // Batch-resolve openerIds → usernames via the bot's discord.js cache.
  // Cache misses are silently skipped; the row falls back to showing the
  // raw ID. We only ask the bot for what's on this page (max 50 IDs).
  const uniqueOpenerIds = Array.from(new Set(tickets.map((t) => t.openerId)));
  const resolved = await callBot<ResolveResponse>({
    path: '/internal/resolve',
    method: 'POST',
    body: { userIds: uniqueOpenerIds },
  });
  const userMap = resolved.ok ? resolved.value.users : {};

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title="Tickets"
        description="Latest 50 tickets — open, claimed, or closed."
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-12">
        <div className="mb-6 flex items-center gap-2">
          {STATUS_FILTERS.map((s) => (
            <Link
              key={s.value}
              href={`/g/${guildId}/tickets${s.value === 'all' ? '' : `?status=${s.value}`}`}
              className={cn(
                'rounded-[var(--radius)] border px-3 py-1.5 text-xs transition-colors',
                filter.value === s.value
                  ? 'bg-[color:var(--color-bg-subtle)] text-[color:var(--color-fg)]'
                  : 'text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg-subtle)]',
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>

        {tickets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-[color:var(--color-fg-muted)]">
                No {filter.value === 'all' ? '' : `${filter.label.toLowerCase()} `}tickets yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/g/${guildId}/tickets/${t.id}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius)] border bg-[color:var(--color-bg)] p-4 transition-colors hover:bg-[color:var(--color-bg-subtle)]"
                >
                  <div className="flex items-center gap-3">
                    {t.panelType.emoji !== '' ? (
                      <span aria-hidden="true">{t.panelType.emoji}</span>
                    ) : null}
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        #{t.number} ·{' '}
                        <span className="text-[color:var(--color-fg-muted)]">
                          {t.panelType.name}
                        </span>
                      </span>
                      <span className="text-xs text-[color:var(--color-fg-muted)]">
                        Opened by {renderUser(userMap, t.openerId)} · {relativeTime(t.openedAt)}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function renderUser(
  userMap: Record<string, { username: string; avatarHash: string | null }>,
  id: string,
): React.ReactNode {
  const u = userMap[id];
  return u !== undefined ? <span>@{u.username}</span> : <code className="font-mono">{id}</code>;
}

function StatusBadge({ status }: { readonly status: TicketStatus }): React.JSX.Element {
  const colorClass =
    status === TicketStatus.closed
      ? 'border-[color:var(--color-fg-muted)] text-[color:var(--color-fg-muted)]'
      : 'border-[color:var(--color-success)] text-[color:var(--color-success)]';
  return (
    <span
      className={cn(
        'rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs font-medium',
        colorClass,
      )}
    >
      {status}
    </span>
  );
}
