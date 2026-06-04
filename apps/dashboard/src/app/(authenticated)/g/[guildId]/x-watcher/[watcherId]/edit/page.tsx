import { and, dbDrizzle, eq, schema } from '@hearth/database';
import { redirect, notFound } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { XWatcherForm } from '@/components/x-watcher/x-watcher-form';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { GuildResources } from '@/types/bot';

interface EditXWatcherPageProps {
  readonly params: Promise<{ readonly guildId: string; readonly watcherId: string }>;
}

export default async function EditXWatcherPage({
  params,
}: EditXWatcherPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');
  const { guildId, watcherId } = await params;

  const [watcher] = await dbDrizzle
    .select()
    .from(schema.xWatcher)
    .where(and(eq(schema.xWatcher.id, watcherId), eq(schema.xWatcher.guildId, guildId)))
    .limit(1);
  if (watcher === undefined) notFound();

  const resources = await callBot<GuildResources>({
    path: `/internal/guilds/${guildId}/resources`,
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
        title={`Edit @${watcher.sourceHandle}`}
        description="Change the destination channel or what gets mirrored. The account itself is fixed."
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-12">
        {!resources.ok ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-sm text-[color:var(--color-fg-muted)]">
                Couldn&rsquo;t load this server&rsquo;s channels — the bot may be offline. Please
                try again.
              </p>
            </CardContent>
          </Card>
        ) : (
          <XWatcherForm
            guildId={guildId}
            channels={resources.value.channels}
            initial={{
              watcherId: watcher.id,
              sourceHandle: watcher.sourceHandle,
              channelId: watcher.channelId,
              includeQuotes: watcher.includeQuotes,
              includeReplies: watcher.includeReplies,
            }}
          />
        )}
      </main>
    </>
  );
}
