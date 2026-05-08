import { asc, dbDrizzle, eq, schema } from '@hearth/database';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteVerificationButton } from '@/components/verification/delete-verification-button';
import { RemoveOptionButton } from '@/components/verification/remove-option-button';
import { RepostVerificationButton } from '@/components/verification/repost-verification-button';
import { RetrySyncVerificationButton } from '@/components/verification/retry-sync-verification-button';
import { SetCorrectControl } from '@/components/verification/set-correct-control';
import { VerificationPreview } from '@/components/verification/verification-preview';
import { branding } from '@/config/branding';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { ResolveResponse } from '@/types/bot';

interface VerificationDetailPageProps {
  readonly params: Promise<{ readonly guildId: string; readonly panelId: string }>;
}

function roleColorToCss(color: number): string {
  if (color === 0) return 'var(--color-fg-muted)';
  return `#${color.toString(16).padStart(6, '0')}`;
}

export default async function VerificationDetailPage({
  params,
}: VerificationDetailPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId, panelId } = await params;
  const panel = await dbDrizzle.query.verificationPanel.findFirst({
    where: eq(schema.verificationPanel.id, panelId),
    with: { options: { orderBy: asc(schema.verificationOption.position) } },
  });
  if (panel === undefined || panel.guildId !== guildId) notFound();

  // Resolve the panel's channel + role IDs to display names. One round-trip,
  // both fall back gracefully to the raw ID on cache miss.
  const resolved = await callBot<ResolveResponse>({
    path: '/internal/resolve',
    method: 'POST',
    body: { channelIds: [panel.channelId], roleIds: [panel.roleId], guildId },
  });
  const channelName = resolved.ok ? resolved.value.channels[panel.channelId]?.name : undefined;
  const role = resolved.ok ? resolved.value.roles[panel.roleId] : undefined;

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;
  const isStale = panel.messageId === 'pending';
  const correctOption =
    panel.correctOptionId === null
      ? null
      : (panel.options.find((o) => o.id === panel.correctOptionId) ?? null);

  const description = `#${channelName ?? panel.channelId} · @${role?.name ?? panel.roleId} · ${String(panel.options.length)} option${panel.options.length === 1 ? '' : 's'}`;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title={panel.embedTitle}
        description={description}
        action={
          <div className="flex items-center gap-2">
            {!isStale ? <RepostVerificationButton guildId={guildId} panelId={panelId} /> : null}
            <Button asChild variant="secondary" size="sm">
              <Link href={`/g/${guildId}/verification/${panelId}/edit`}>Edit</Link>
            </Button>
          </div>
        }
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-8 py-12">
        {isStale ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Discord message not synced</CardTitle>
              <CardDescription>
                The panel row was saved but Discord wasn&rsquo;t updated. Add at least one option,
                set the correct one, then retry sync.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RetrySyncVerificationButton guildId={guildId} panelId={panelId} />
            </CardContent>
          </Card>
        ) : null}

        {panel.options.length > 0 && panel.correctOptionId === null ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Correct option not set</CardTitle>
              <CardDescription>
                Without a correct option, every click is treated as wrong and no role is granted.
                Pick one below.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <Card>
          <CardContent className="pt-6">
            <VerificationPreview
              title={panel.embedTitle}
              description={panel.embedDescription}
              footerText={branding.footerText}
              correctOptionId={panel.correctOptionId}
              options={panel.options.map((o) => ({
                id: o.id,
                label: o.label,
                emoji: o.emoji === '' ? undefined : o.emoji,
                style: o.buttonStyle as 'primary' | 'secondary' | 'success' | 'danger',
                position: o.position,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-base">Options</CardTitle>
              <CardDescription>
                Up to 5 buttons per panel. Each must have a unique label and slot.
              </CardDescription>
            </div>
            <Button asChild size="sm" disabled={panel.options.length >= 5}>
              <Link href={`/g/${guildId}/verification/${panelId}/options/new`}>Add option</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {panel.options.length === 0 ? (
              <p className="text-sm text-[color:var(--color-fg-muted)]">
                No options yet — add one to start.
              </p>
            ) : (
              <ul className="grid gap-2">
                {panel.options.map((o) => {
                  const isCorrect = o.id === panel.correctOptionId;
                  return (
                    <li
                      key={o.id}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius)] border p-3"
                    >
                      <div className="flex items-center gap-3">
                        {o.emoji !== '' ? <span aria-hidden="true">{o.emoji}</span> : null}
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{o.label}</span>
                          <span className="font-mono text-xs text-[color:var(--color-fg-muted)]">
                            slot {String(o.position)} · {o.buttonStyle}
                          </span>
                        </div>
                        {isCorrect ? (
                          <span className="rounded-[var(--radius-sm)] bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-accent-fg)]">
                            Correct
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/g/${guildId}/verification/${panelId}/options/${o.id}/edit`}>
                            Edit
                          </Link>
                        </Button>
                        <RemoveOptionButton
                          guildId={guildId}
                          panelId={panelId}
                          optionId={o.id}
                          optionLabel={o.label}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {panel.options.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Correct option</CardTitle>
              <CardDescription className="flex items-center gap-2">
                {correctOption !== null ? (
                  <>
                    <span>Currently:</span>
                    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-2 py-0.5 text-xs font-medium text-[color:var(--color-fg)]">
                      {correctOption.emoji !== '' ? (
                        <span aria-hidden="true">{correctOption.emoji}</span>
                      ) : null}
                      <span>{correctOption.label}</span>
                    </span>
                    <span>
                      grants{' '}
                      <span className="inline-flex items-center gap-1 text-[color:var(--color-fg)]">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: roleColorToCss(role?.color ?? 0) }}
                          aria-hidden="true"
                        />
                        @{role?.name ?? panel.roleId}
                      </span>
                    </span>
                  </>
                ) : (
                  <span>No option marked correct yet.</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SetCorrectControl
                guildId={guildId}
                panelId={panelId}
                correctOptionId={panel.correctOptionId}
                options={panel.options.map((o) => ({
                  id: o.id,
                  label: o.label,
                  emoji: o.emoji,
                }))}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card destructive>
          <CardHeader>
            <CardTitle className="text-base">Danger zone</CardTitle>
            <CardDescription>
              Delete the panel, its options, and its event log. The Discord message is removed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteVerificationButton guildId={guildId} panelId={panelId} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
