import { asc, dbDrizzle, eq, schema } from '@hearth/database';
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
  // Fetch panels with their ticketTypes + tickets ID-only — we just need
  // counts for the list summary. Drizzle has no `_count` aggregate
  // include like Prisma; an extras-with-subquery would be more efficient
  // for large N but typical guilds have a handful of panels, so reading
  // ID arrays and taking `.length` keeps the call site obvious.
  const panels = await dbDrizzle.query.panel.findMany({
    where: eq(schema.panel.guildId, guildId),
    orderBy: asc(schema.panel.createdAt),
    with: {
      ticketTypes: { columns: { id: true } },
      tickets: { columns: { id: true } },
    },
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
                        {p.ticketTypes.length} type{p.ticketTypes.length === 1 ? '' : 's'} ·{' '}
                        {p.tickets.length} ticket{p.tickets.length === 1 ? '' : 's'}
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
