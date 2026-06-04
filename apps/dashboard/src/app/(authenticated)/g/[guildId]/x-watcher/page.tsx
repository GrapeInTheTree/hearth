import { desc, dbDrizzle, eq, schema } from '@hearth/database';
import { AtSign, Hash, Rss } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { ResolveResponse } from '@/types/bot';

interface XWatcherListPageProps {
  readonly params: Promise<{ readonly guildId: string }>;
}

export default async function XWatcherListPage({
  params,
}: XWatcherListPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId } = await params;
  const watchers = await dbDrizzle
    .select()
    .from(schema.xWatcher)
    .where(eq(schema.xWatcher.guildId, guildId))
    .orderBy(desc(schema.xWatcher.createdAt));

  const channelIds = Array.from(new Set(watchers.map((w) => w.channelId)));
  const resolved = await callBot<ResolveResponse>({
    path: '/internal/resolve',
    method: 'POST',
    body: { channelIds, guildId },
  });
  const channelMap = resolved.ok ? resolved.value.channels : {};

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title="X feed"
        description="Mirror a watched X (Twitter) account's new posts into a channel as bare links."
        action={
          <Button asChild>
            <Link href={`/g/${guildId}/x-watcher/new`}>New watcher</Link>
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-12">
        {watchers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <Rss className="h-10 w-10 text-[color:var(--color-fg-muted)]" aria-hidden="true" />
              <p className="text-base font-medium">No watchers yet</p>
              <p className="max-w-sm text-sm text-[color:var(--color-fg-muted)]">
                Point the bot at an X account and a channel. Every new original or quote post shows
                up as a bare link — retweets are skipped.
              </p>
              <Button asChild>
                <Link href={`/g/${guildId}/x-watcher/new`}>Create your first watcher</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-3">
            {watchers.map((w) => {
              const channelName = channelMap[w.channelId]?.name;
              return (
                <li key={w.id}>
                  <Link href={`/g/${guildId}/x-watcher/${w.id}`} className="block">
                    <Card className="transition-colors hover:bg-[color:var(--color-bg-subtle)]">
                      <CardContent className="flex items-center justify-between gap-3 py-5">
                        <div className="flex min-w-0 flex-col gap-1">
                          <p className="inline-flex items-center gap-1 truncate text-base font-semibold">
                            <AtSign className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {w.sourceHandle}
                          </p>
                          <span className="inline-flex items-center gap-1 text-xs text-[color:var(--color-fg-muted)]">
                            <Hash className="h-3 w-3" aria-hidden="true" />
                            {channelName ?? w.channelId}
                          </span>
                        </div>
                        <span
                          className={
                            w.enabled
                              ? 'shrink-0 rounded-full bg-[color:var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium text-[color:var(--color-accent)]'
                              : 'shrink-0 rounded-full bg-[color:var(--color-bg-subtle)] px-2.5 py-1 text-xs font-medium text-[color:var(--color-fg-muted)]'
                          }
                        >
                          {w.enabled ? 'Active' : 'Paused'}
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
