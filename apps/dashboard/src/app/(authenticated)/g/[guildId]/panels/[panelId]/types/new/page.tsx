import { db } from '@hearth/database';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { TicketTypeForm } from '@/components/panels/ticket-type-form';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { GuildResources } from '@/types/bot';

interface NewTypePageProps {
  readonly params: Promise<{ readonly guildId: string; readonly panelId: string }>;
}

export default async function NewTypePage({
  params,
}: NewTypePageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');
  const { guildId, panelId } = await params;

  const [panel, resources] = await Promise.all([
    db.panel.findUnique({
      where: { id: panelId },
      select: { id: true, guildId: true, embedTitle: true },
    }),
    callBot<GuildResources>({ path: `/internal/guilds/${guildId}/resources` }),
  ]);
  if (panel === null || panel.guildId !== guildId) notFound();

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title="Add ticket type"
        description={panel.embedTitle}
      />
      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-12">
        {!resources.ok ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-[color:var(--color-fg-muted)]">
                Couldn&rsquo;t load this server&rsquo;s categories or roles — the bot may be
                offline.
              </p>
            </CardContent>
          </Card>
        ) : (
          <TicketTypeForm
            guildId={guildId}
            panelId={panelId}
            categories={resources.value.categories}
            roles={resources.value.roles}
          />
        )}
      </main>
    </>
  );
}
