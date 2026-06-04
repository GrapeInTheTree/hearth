import { and, dbDrizzle, desc, eq, schema } from '@hearth/database';
import { AtSign, CheckCircle2, ExternalLink, Repeat2, Reply, XCircle } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteXWatcherButton } from '@/components/x-watcher/delete-x-watcher-button';
import { PollNowButton } from '@/components/x-watcher/poll-now-button';
import { ToggleEnabledButton } from '@/components/x-watcher/toggle-enabled-button';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { ResolveResponse } from '@/types/bot';

interface XWatcherDetailPageProps {
  readonly params: Promise<{ readonly guildId: string; readonly watcherId: string }>;
}

// status → how the feed row reads. `posted` is the happy path; the skips
// explain why a post wasn't mirrored; send_failed flags a Discord problem.
const STATUS_META: Record<
  string,
  { label: string; icon: typeof CheckCircle2; tone: 'ok' | 'muted' | 'danger' }
> = {
  posted: { label: 'Mirrored', icon: CheckCircle2, tone: 'ok' },
  skipped_retweet: { label: 'Skipped — retweet', icon: Repeat2, tone: 'muted' },
  skipped_reply: { label: 'Skipped — reply', icon: Reply, tone: 'muted' },
  skipped_quote: { label: 'Skipped — quote', icon: Repeat2, tone: 'muted' },
  send_failed: { label: 'Send failed', icon: XCircle, tone: 'danger' },
};

const TONE_CLASS: Record<'ok' | 'muted' | 'danger', string> = {
  ok: 'text-[color:var(--color-accent)]',
  muted: 'text-[color:var(--color-fg-muted)]',
  danger: 'text-[color:var(--color-danger)]',
};

export default async function XWatcherDetailPage({
  params,
}: XWatcherDetailPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId, watcherId } = await params;
  const [watcher] = await dbDrizzle
    .select()
    .from(schema.xWatcher)
    .where(and(eq(schema.xWatcher.id, watcherId), eq(schema.xWatcher.guildId, guildId)))
    .limit(1);
  if (watcher === undefined) notFound();

  const events = await dbDrizzle
    .select()
    .from(schema.xWatcherEvent)
    .where(eq(schema.xWatcherEvent.watcherId, watcherId))
    .orderBy(desc(schema.xWatcherEvent.createdAt))
    .limit(15);

  const resolved = await callBot<ResolveResponse>({
    path: '/internal/resolve',
    method: 'POST',
    body: { channelIds: [watcher.channelId], guildId },
  });
  const channelName = resolved.ok ? resolved.value.channels[watcher.channelId]?.name : undefined;

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  const facts: { label: string; value: string }[] = [
    { label: 'Channel', value: channelName !== undefined ? `#${channelName}` : watcher.channelId },
    { label: 'Quote posts', value: watcher.includeQuotes ? 'Mirrored' : 'Skipped' },
    { label: 'Replies', value: watcher.includeReplies ? 'Mirrored' : 'Skipped' },
    { label: 'Retweets', value: 'Never mirrored' },
    {
      label: 'Last checked',
      value: watcher.lastCheckedAt !== null ? watcher.lastCheckedAt.toLocaleString() : 'Never',
    },
    {
      label: 'Position',
      value: watcher.lastTweetId !== null ? `up to ${watcher.lastTweetId}` : 'Not yet primed',
    },
  ];

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title={`@${watcher.sourceHandle}`}
        description="X feed watcher"
        action={
          <div className="flex items-center gap-2">
            <PollNowButton guildId={guildId} watcherId={watcher.id} />
            <ToggleEnabledButton
              guildId={guildId}
              watcherId={watcher.id}
              enabled={watcher.enabled}
            />
            <Button asChild variant="secondary" size="sm">
              <Link href={`/g/${guildId}/x-watcher/${watcher.id}/edit`}>Edit</Link>
            </Button>
            <DeleteXWatcherButton
              guildId={guildId}
              watcherId={watcher.id}
              handle={watcher.sourceHandle}
            />
          </div>
        }
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-8 py-12">
        <Card>
          <CardContent className="flex flex-col gap-4 py-5">
            <div className="flex items-center gap-2">
              <AtSign className="h-4 w-4 text-[color:var(--color-fg-muted)]" aria-hidden="true" />
              <span className="font-semibold">{watcher.sourceHandle}</span>
              <span
                className={
                  watcher.enabled
                    ? 'rounded-full bg-[color:var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium text-[color:var(--color-accent)]'
                    : 'rounded-full bg-[color:var(--color-bg-subtle)] px-2.5 py-1 text-xs font-medium text-[color:var(--color-fg-muted)]'
                }
              >
                {watcher.enabled ? 'Active' : 'Paused'}
              </span>
            </div>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map((f) => (
                <div key={f.label} className="flex flex-col gap-0.5">
                  <dt className="text-xs uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                    {f.label}
                  </dt>
                  <dd className="text-sm">{f.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          {events.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-[color:var(--color-fg-muted)]">
                Nothing yet. The first poll primes the watcher silently; posts after that show up
                here.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col divide-y divide-[color:var(--color-border)] py-0">
                {events.map((e) => {
                  const meta = STATUS_META[e.status] ?? {
                    label: e.status,
                    icon: CheckCircle2,
                    tone: 'muted' as const,
                  };
                  const Icon = meta.icon;
                  return (
                    <div key={e.id} className="flex items-center gap-3 py-3">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${TONE_CLASS[meta.tone]}`}
                        aria-hidden="true"
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="text-sm">{meta.label}</span>
                        <span className="text-xs text-[color:var(--color-fg-muted)]">
                          {e.createdAt.toLocaleString()}
                        </span>
                      </div>
                      <a
                        href={e.tweetUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-[color:var(--color-accent)] hover:underline"
                      >
                        View
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </section>
      </main>
    </>
  );
}
