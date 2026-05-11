import { dbDrizzle, eq, schema } from '@hearth/database';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { SelfRolesOptionForm } from '@/components/self-roles/self-roles-option-form';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { GuildResources } from '@/types/bot';

interface EditSelfRolesOptionPageProps {
  readonly params: Promise<{
    readonly guildId: string;
    readonly panelId: string;
    readonly optionId: string;
  }>;
}

export default async function EditSelfRolesOptionPage({
  params,
}: EditSelfRolesOptionPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');
  const { guildId, panelId, optionId } = await params;

  const [option, resources] = await Promise.all([
    dbDrizzle.query.selfRolesOption.findFirst({
      where: eq(schema.selfRolesOption.id, optionId),
      with: { panel: true },
    }),
    callBot<GuildResources>({ path: `/internal/guilds/${guildId}/resources` }),
  ]);
  if (option === undefined || option.panelId !== panelId || option.panel.guildId !== guildId) {
    notFound();
  }

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title="Edit self-roles option"
        description={option.label}
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
            initial={{
              optionId: option.id,
              label: option.label,
              emoji: option.emoji,
              roleId: option.roleId,
              position: option.position,
            }}
          />
        )}
      </main>
    </>
  );
}
