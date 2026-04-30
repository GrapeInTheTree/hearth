import { dbDrizzle, eq, schema } from '@hearth/database';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { TicketTypeForm } from '@/components/panels/ticket-type-form';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { GuildResources } from '@/types/bot';

type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger';

interface EditTypePageProps {
  readonly params: Promise<{
    readonly guildId: string;
    readonly panelId: string;
    readonly typeId: string;
  }>;
}

export default async function EditTypePage({
  params,
}: EditTypePageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');
  const { guildId, panelId, typeId } = await params;

  const [type, resources] = await Promise.all([
    dbDrizzle.query.panelTicketType.findFirst({
      where: eq(schema.panelTicketType.id, typeId),
      with: { panel: { columns: { id: true, guildId: true } } },
    }),
    callBot<GuildResources>({ path: `/internal/guilds/${guildId}/resources` }),
  ]);
  if (type === undefined || type.panel.guildId !== guildId || type.panel.id !== panelId) {
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
        title={`Edit ${type.name}`}
        description={type.buttonLabel ?? type.name}
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
            initial={{
              typeId: type.id,
              name: type.name,
              label: type.buttonLabel ?? type.name,
              emoji: type.emoji,
              buttonStyle: type.buttonStyle as ButtonStyle,
              activeCategoryId: type.activeCategoryId,
              supportRoleIds: type.supportRoleIds,
              pingRoleIds: type.pingRoleIds,
              perUserLimit: type.perUserLimit,
              welcomeMessage: type.welcomeMessage,
            }}
          />
        )}
      </main>
    </>
  );
}
