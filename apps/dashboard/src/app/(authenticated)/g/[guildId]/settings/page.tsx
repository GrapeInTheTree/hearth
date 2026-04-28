import { db } from '@discord-bot/database';
import { redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { SettingsForm } from '@/components/settings/settings-form';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { GuildResources } from '@/types/bot';

interface SettingsPageProps {
  readonly params: Promise<{ readonly guildId: string }>;
}

export default async function SettingsPage({
  params,
}: SettingsPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId } = await params;
  const [config, resources] = await Promise.all([
    db.guildConfig.findUnique({ where: { guildId } }),
    callBot<GuildResources>({ path: `/internal/guilds/${guildId}/resources` }),
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
        title="Settings"
        description="Server-wide ticket configuration."
      />
      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-12">
        {!resources.ok ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-[color:var(--color-fg-muted)]">
                Couldn&rsquo;t load this server&rsquo;s channels and categories — the bot may be
                offline.
              </p>
            </CardContent>
          </Card>
        ) : (
          <SettingsForm
            guildId={guildId}
            channels={resources.value.channels}
            categories={resources.value.categories}
            initial={{
              archiveCategoryId: config?.archiveCategoryId ?? null,
              alertChannelId: config?.alertChannelId ?? null,
            }}
          />
        )}
      </main>
    </>
  );
}
