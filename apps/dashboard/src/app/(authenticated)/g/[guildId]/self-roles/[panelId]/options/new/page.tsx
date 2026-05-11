import { dbDrizzle, eq, schema } from '@hearth/database';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { SelfRolesOptionForm } from '@/components/self-roles/self-roles-option-form';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { GuildResources } from '@/types/bot';

interface NewSelfRolesOptionPageProps {
  readonly params: Promise<{ readonly guildId: string; readonly panelId: string }>;
}

export default async function NewSelfRolesOptionPage({
  params,
}: NewSelfRolesOptionPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');
  const { guildId, panelId } = await params;

  const [panel, resources] = await Promise.all([
    dbDrizzle.query.selfRolesPanel.findFirst({
      where: eq(schema.selfRolesPanel.id, panelId),
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
        title="Add self-roles option"
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
          <SelfRolesOptionForm
            guildId={guildId}
            panelId={panelId}
            roles={resources.value.roles.filter((r) => !r.managed)}
          />
        )}
      </main>
    </>
  );
}
