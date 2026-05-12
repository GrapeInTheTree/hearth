import { dbDrizzle, eq, schema } from '@hearth/database';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { ReactionRolesOptionForm } from '@/components/reaction-roles/reaction-roles-option-form';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { GuildResources } from '@/types/bot';

interface NewReactionRolesOptionPageProps {
  readonly params: Promise<{ readonly guildId: string; readonly panelId: string }>;
}

export default async function NewReactionRolesOptionPage({
  params,
}: NewReactionRolesOptionPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');
  const { guildId, panelId } = await params;

  const [panel, resources] = await Promise.all([
    dbDrizzle.query.reactionRolesPanel.findFirst({
      where: eq(schema.reactionRolesPanel.id, panelId),
    }),
    callBot<GuildResources>({ path: `/internal/guilds/${guildId}/resources` }),
  ]);
  if (panel === undefined || panel.guildId !== guildId) notFound();

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title="Add reaction-roles option"
        description={`Panel: ${panel.embedTitle}`}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-12">
        {!resources.ok ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-[color:var(--color-fg-muted)]">
                Couldn&rsquo;t load this server&rsquo;s roles — the bot may be offline.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ReactionRolesOptionForm
            guildId={guildId}
            panelId={panelId}
            roles={resources.value.roles.filter((r) => !r.managed)}
          />
        )}
      </main>
    </>
  );
}
