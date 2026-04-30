import { dbDrizzle, eq, schema } from '@hearth/database';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { PanelForm } from '@/components/panels/panel-form';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { GuildResources } from '@/types/bot';

interface EditPanelPageProps {
  readonly params: Promise<{ readonly guildId: string; readonly panelId: string }>;
}

export default async function EditPanelPage({
  params,
}: EditPanelPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');
  const { guildId, panelId } = await params;

  const [panelRow, resources] = await Promise.all([
    dbDrizzle
      .select()
      .from(schema.panel)
      .where(eq(schema.panel.id, panelId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    callBot<GuildResources>({ path: `/internal/guilds/${guildId}/resources` }),
  ]);
  if (panelRow === null || panelRow.guildId !== guildId) notFound();
  const panel = panelRow;

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title="Edit panel"
        description={`#${panel.channelId}`}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-12">
        {!resources.ok ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-[color:var(--color-fg-muted)]">
                Couldn&rsquo;t load this server&rsquo;s channels — the bot may be offline.
              </p>
            </CardContent>
          </Card>
        ) : (
          <PanelForm
            guildId={guildId}
            channels={resources.value.channels}
            initial={{
              panelId: panel.id,
              channelId: panel.channelId,
              embedTitle: panel.embedTitle,
              embedDescription: panel.embedDescription,
            }}
          />
        )}
      </main>
    </>
  );
}
