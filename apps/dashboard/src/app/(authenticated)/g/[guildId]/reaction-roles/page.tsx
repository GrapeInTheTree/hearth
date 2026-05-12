import { asc, dbDrizzle, eq, schema } from '@hearth/database';
import { Hash, Languages } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { ResolveResponse } from '@/types/bot';

interface ReactionRolesListPageProps {
  readonly params: Promise<{ readonly guildId: string }>;
}

export default async function ReactionRolesListPage({
  params,
}: ReactionRolesListPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId } = await params;
  const panels = await dbDrizzle.query.reactionRolesPanel.findMany({
    where: eq(schema.reactionRolesPanel.guildId, guildId),
    orderBy: asc(schema.reactionRolesPanel.createdAt),
    with: {
      options: { columns: { id: true, label: true, emoji: true } },
    },
  });

  const channelIds = Array.from(new Set(panels.map((p) => p.channelId)));
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
        title="Self-roles"
        description="Reaction-based panels — users add a flag to gain a role, remove to give it back."
        action={
          <Button asChild>
            <Link href={`/g/${guildId}/reaction-roles/new`}>New panel</Link>
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-12">
        {panels.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <Languages
                className="h-10 w-10 text-[color:var(--color-fg-muted)]"
                aria-hidden="true"
              />
              <p className="text-base font-medium">No reaction-roles panels yet</p>
              <p className="max-w-sm text-sm text-[color:var(--color-fg-muted)]">
                Create a panel, bind emojis to roles, and post it to a channel. Members react with
                the flag for the language(s) they want — multi-select is native.
              </p>
              <Button asChild>
                <Link href={`/g/${guildId}/reaction-roles/new`}>Create your first panel</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-3">
            {panels.map((p) => {
              const channelName = channelMap[p.channelId]?.name;
              return (
                <li key={p.id}>
                  <Link href={`/g/${guildId}/reaction-roles/${p.id}`} className="block">
                    <Card className="transition-colors hover:bg-[color:var(--color-bg-subtle)]">
                      <CardContent className="flex flex-col gap-3 py-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-col gap-1">
                            <p className="truncate text-base font-semibold">{p.embedTitle}</p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--color-fg-muted)]">
                              <span className="inline-flex items-center gap-1">
                                <Hash className="h-3 w-3" aria-hidden="true" />
                                {channelName ?? p.channelId}
                              </span>
                              <span>
                                {p.options.length} option{p.options.length === 1 ? '' : 's'}
                              </span>
                            </div>
                          </div>
                          <span className="flex shrink-0 flex-wrap items-center gap-1 text-base">
                            {p.options.slice(0, 6).map((o) => (
                              <span key={o.id} aria-hidden="true" title={o.label}>
                                {o.emoji}
                              </span>
                            ))}
                            {p.options.length > 6 ? (
                              <span className="text-xs text-[color:var(--color-fg-muted)]">
                                +{p.options.length - 6}
                              </span>
                            ) : null}
                          </span>
                        </div>
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
