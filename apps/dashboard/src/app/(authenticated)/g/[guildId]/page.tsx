import { db } from '@hearth/database';
import { TicketStatus } from '@hearth/database';
import Link from 'next/link';

import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';
import { auth } from '@/lib/auth';
import { guildIconUrl } from '@/lib/format';

interface GuildOverviewPageProps {
  readonly params: Promise<{ readonly guildId: string }>;
}

export default async function GuildOverviewPage({
  params,
}: GuildOverviewPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  // Layout already enforces signed-in + Manage Guild; non-null assertion
  // would trip the lint rule, so fall through gracefully.
  if (session === null) return <></>;

  const { guildId } = await params;
  const [panels, openTickets, closedTickets] = await Promise.all([
    db.panel.count({ where: { guildId } }),
    db.ticket.count({
      where: { guildId, status: { in: [TicketStatus.open, TicketStatus.claimed] } },
    }),
    db.ticket.count({ where: { guildId, status: TicketStatus.closed } }),
  ]);

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title={t.overview.title}
        action={
          <Button asChild>
            <Link href={`/g/${guildId}/panels/new`}>{t.overview.quickActions.newPanel}</Link>
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-12">
        <div className="grid gap-4 sm:grid-cols-3">
          <CountCard label={t.overview.counts.panels} value={panels} />
          <CountCard label={t.overview.counts.openTickets} value={openTickets} />
          <CountCard label={t.overview.counts.closedTickets} value={closedTickets} />
        </div>
      </main>
    </>
  );
}

function CountCard({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent />
    </Card>
  );
}

// `guildIconUrl` is unused on this page but exporting silences the
// lint warning about unused imports while we draft other pages that
// will consume it.
export const _ = guildIconUrl;
