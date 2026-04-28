import { db } from '@discord-bot/database';
import Link from 'next/link';

import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';

interface PanelsListPageProps {
  readonly params: Promise<{ readonly guildId: string }>;
}

export default async function PanelsListPage({
  params,
}: PanelsListPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) return <></>;

  const { guildId } = await params;
  const panels = await db.panel.findMany({
    where: { guildId },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { ticketTypes: true, tickets: true } } },
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
        title="Panels"
        description="One message per panel; one button per ticket type."
        action={
          <Button asChild>
            <Link href={`/g/${guildId}/panels/new`}>New panel</Link>
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-12">
        {panels.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <p className="text-base font-medium">No panels yet</p>
              <p className="max-w-sm text-sm text-[color:var(--color-fg-muted)]">
                Create a panel and pick the channel where the embed message lives. Then add ticket
                types — one button per type.
              </p>
              <Button asChild>
                <Link href={`/g/${guildId}/panels/new`}>Create your first panel</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-3">
            {panels.map((p) => (
              <li key={p.id}>
                <Link href={`/g/${guildId}/panels/${p.id}`}>
                  <Card className="transition-colors hover:bg-[color:var(--color-bg-subtle)]">
                    <CardHeader>
                      <CardTitle className="text-base">{p.embedTitle}</CardTitle>
                      <CardDescription>
                        <code className="font-mono text-xs">#{p.channelId}</code> ·{' '}
                        {p._count.ticketTypes} type{p._count.ticketTypes === 1 ? '' : 's'} ·{' '}
                        {p._count.tickets} ticket{p._count.tickets === 1 ? '' : 's'}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
