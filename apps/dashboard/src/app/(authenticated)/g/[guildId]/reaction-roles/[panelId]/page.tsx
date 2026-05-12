import { asc, dbDrizzle, eq, schema } from '@hearth/database';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { DeleteReactionRolesButton } from '@/components/reaction-roles/delete-reaction-roles-button';
import { ReactionRolesPreview } from '@/components/reaction-roles/reaction-roles-preview';
import { RemoveReactionRolesOptionButton } from '@/components/reaction-roles/remove-reaction-roles-option-button';
import { RepostReactionRolesButton } from '@/components/reaction-roles/repost-reaction-roles-button';
import { RetrySyncReactionRolesButton } from '@/components/reaction-roles/retry-sync-reaction-roles-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { branding } from '@/config/branding';
import { auth } from '@/lib/auth';
import { callBot } from '@/lib/botClient';
import type { ResolveResponse } from '@/types/bot';

interface ReactionRolesDetailPageProps {
  readonly params: Promise<{ readonly guildId: string; readonly panelId: string }>;
}

function roleColorToCss(color: number): string {
  if (color === 0) return 'var(--color-fg-muted)';
  return `#${color.toString(16).padStart(6, '0')}`;
}

export default async function ReactionRolesDetailPage({
  params,
}: ReactionRolesDetailPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId, panelId } = await params;
  const panel = await dbDrizzle.query.reactionRolesPanel.findFirst({
    where: eq(schema.reactionRolesPanel.id, panelId),
    with: { options: { orderBy: asc(schema.reactionRolesOption.position) } },
  });
  if (panel === undefined || panel.guildId !== guildId) notFound();

  const roleIds = Array.from(new Set(panel.options.map((o) => o.roleId)));
  const resolved = await callBot<ResolveResponse>({
    path: '/internal/resolve',
    method: 'POST',
    body: { channelIds: [panel.channelId], roleIds, guildId },
  });
  const channelName = resolved.ok ? resolved.value.channels[panel.channelId]?.name : undefined;
  const roleMap = resolved.ok ? resolved.value.roles : {};

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;
  const isStale = panel.messageId === 'pending';

  const description = `#${channelName ?? panel.channelId} · ${String(panel.options.length)} option${panel.options.length === 1 ? '' : 's'}`;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title={panel.embedTitle}
        description={description}
        action={
          <div className="flex items-center gap-2">
            {!isStale ? <RepostReactionRolesButton guildId={guildId} panelId={panelId} /> : null}
            <Button asChild variant="secondary" size="sm">
              <Link href={`/g/${guildId}/reaction-roles/${panelId}/edit`}>Edit</Link>
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
                then retry sync.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RetrySyncReactionRolesButton guildId={guildId} panelId={panelId} />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="pt-6">
            <ReactionRolesPreview
              title={panel.embedTitle}
              description={panel.embedDescription}
              footerText={branding.footerText}
              options={panel.options.map((o) => {
                const role = roleMap[o.roleId];
                return {
                  id: o.id,
                  label: o.label,
                  emoji: o.emoji,
                  roleId: o.roleId,
                  roleName: role?.name,
                  roleColor: role?.color,
                  position: o.position,
                };
              })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-base">Options</CardTitle>
              <CardDescription>
                Up to 20 emoji-role bindings per panel. Each must have a unique emoji and slot.
              </CardDescription>
            </div>
            <Button asChild size="sm" disabled={panel.options.length >= 20}>
              <Link href={`/g/${guildId}/reaction-roles/${panelId}/options/new`}>Add option</Link>
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
                  const role = roleMap[o.roleId];
                  return (
                    <li
                      key={o.id}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius)] border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <span aria-hidden="true" className="text-base">
                          {o.emoji}
                        </span>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{o.label}</span>
                          <span className="font-mono text-xs text-[color:var(--color-fg-muted)]">
                            slot {String(o.position)}
                          </span>
                        </div>
                        <span
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-2 py-0.5 text-xs"
                          style={
                            role !== undefined ? { color: roleColorToCss(role.color) } : undefined
                          }
                        >
                          @{role?.name ?? `role:${o.roleId.slice(-4)}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            href={`/g/${guildId}/reaction-roles/${panelId}/options/${o.id}/edit`}
                          >
                            Edit
                          </Link>
                        </Button>
                        <RemoveReactionRolesOptionButton
                          guildId={guildId}
                          panelId={panelId}
                          optionId={o.id}
                          optionLabel={o.label}
                          optionEmoji={o.emoji}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card destructive>
          <CardHeader>
            <CardTitle className="text-base">Danger zone</CardTitle>
            <CardDescription>
              Delete the panel, its options, and its event log. The Discord message is removed.
              Existing role grants on users stay.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteReactionRolesButton guildId={guildId} panelId={panelId} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
