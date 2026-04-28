import { db, TicketStatus } from '@discord-bot/database';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

interface TicketsListPageProps {
  readonly params: Promise<{ readonly guildId: string }>;
  readonly searchParams: Promise<{ readonly status?: string }>;
}

const STATUS_FILTERS: readonly {
  value: string;
  label: string;
  predicate: { in: TicketStatus[] } | TicketStatus | undefined;
}[] = [
  { value: 'all', label: 'All', predicate: undefined },
  { value: 'open', label: 'Open', predicate: { in: [TicketStatus.open, TicketStatus.claimed] } },
  { value: 'closed', label: 'Closed', predicate: TicketStatus.closed },
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

  const tickets = await db.ticket.findMany({
    where: {
      guildId,
      ...(filter.predicate !== undefined ? { status: filter.predicate } : {}),
    },
    include: { panelType: { select: { name: true, emoji: true } } },
    orderBy: { openedAt: 'desc' },
    take: 50,
  });

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
                        Opened by <code className="font-mono">{t.openerId}</code> ·{' '}
                        {relativeTime(t.openedAt)}
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
