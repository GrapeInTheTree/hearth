import { asc, dbDrizzle, eq, schema } from '@hearth/database';
import { Hash, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { ResolveResponse } from '@/types/bot';

interface VerificationListPageProps {
  readonly params: Promise<{ readonly guildId: string }>;
}

function roleColorToCss(color: number): string {
  if (color === 0) return 'var(--color-fg-muted)';
  return `#${color.toString(16).padStart(6, '0')}`;
}

export default async function VerificationListPage({
  params,
}: VerificationListPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId } = await params;
  const panels = await dbDrizzle.query.verificationPanel.findMany({
    where: eq(schema.verificationPanel.guildId, guildId),
    orderBy: asc(schema.verificationPanel.createdAt),
    with: {
      options: { columns: { id: true, label: true } },
    },
  });

  // Batch-resolve channel + role IDs to display names. Mirrors the
  // tickets list page pattern. Cache misses fall back to the raw ID.
  const channelIds = Array.from(new Set(panels.map((p) => p.channelId)));
  const roleIds = Array.from(new Set(panels.map((p) => p.roleId)));
  const resolved = await callBot<ResolveResponse>({
    path: '/internal/resolve',
    method: 'POST',
    body: { channelIds, roleIds, guildId },
  });
  const channelMap = resolved.ok ? resolved.value.channels : {};
  const roleMap = resolved.ok ? resolved.value.roles : {};

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title="Verification"
        description="Click-to-verify panels — one role granted on the correct emoji."
        action={
          <Button asChild>
            <Link href={`/g/${guildId}/verification/new`}>New panel</Link>
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-12">
        {panels.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
              <ShieldCheck
                className="h-10 w-10 text-[color:var(--color-fg-muted)]"
                aria-hidden="true"
              />
              <p className="text-base font-medium">No verification panels yet</p>
              <p className="max-w-sm text-sm text-[color:var(--color-fg-muted)]">
                Create a panel, add up to five emoji buttons, set the correct one, and repost it to
                your channel. Members click the correct button to receive their role.
              </p>
              <Button asChild>
                <Link href={`/g/${guildId}/verification/new`}>Create your first panel</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-3">
            {panels.map((p) => {
              const channelName = channelMap[p.channelId]?.name;
              const role = roleMap[p.roleId];
              const correctOption =
                p.correctOptionId === null
                  ? null
                  : (p.options.find((o) => o.id === p.correctOptionId) ?? null);

              return (
                <li key={p.id}>
                  <Link href={`/g/${guildId}/verification/${p.id}`} className="block">
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
                              <span className="inline-flex items-center gap-1">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{
                                    backgroundColor: roleColorToCss(role?.color ?? 0),
                                  }}
                                  aria-hidden="true"
                                />
                                @{role?.name ?? p.roleId}
                              </span>
                              <span>
                                {p.options.length} option{p.options.length === 1 ? '' : 's'}
                              </span>
                            </div>
                          </div>
                          {correctOption === null ? (
                            <span className="shrink-0 rounded-[var(--radius-sm)] bg-[color:var(--color-bg-subtle)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                              No correct option
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-2 py-0.5 text-xs">
                              ✓ {correctOption.label}
                            </span>
                          )}
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
