import { asc, dbDrizzle, eq, schema } from '@hearth/database';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { DeletePanelButton } from '@/components/panels/delete-panel-button';
import { PanelPreview } from '@/components/panels/panel-preview';
import { RemoveTypeButton } from '@/components/panels/remove-type-button';
import { RetrySyncButton } from '@/components/panels/retry-sync-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { branding } from '@/config/branding';
import { auth } from '@/lib/auth';

interface PanelDetailPageProps {
  readonly params: Promise<{ readonly guildId: string; readonly panelId: string }>;
}

export default async function PanelDetailPage({
  params,
}: PanelDetailPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) redirect('/login');

  const { guildId, panelId } = await params;
  const panel = await dbDrizzle.query.panel.findFirst({
    where: eq(schema.panel.id, panelId),
    with: { ticketTypes: { orderBy: asc(schema.panelTicketType.buttonOrder) } },
  });
  if (panel === undefined || panel.guildId !== guildId) notFound();

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;
  const isStale = panel.messageId === 'pending';

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title={panel.embedTitle}
        description={`#${panel.channelId} · ${panel.ticketTypes.length} type${panel.ticketTypes.length === 1 ? '' : 's'}`}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/g/${guildId}/panels/${panelId}/edit`}>Edit</Link>
          </Button>
        }
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-8 py-12">
        {isStale ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Discord message not synced</CardTitle>
              <CardDescription>
                The panel row was created but Discord wasn&rsquo;t updated. Retry to push it now.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RetrySyncButton guildId={guildId} panelId={panelId} />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardContent className="pt-6">
            <PanelPreview
              title={panel.embedTitle}
              description={panel.embedDescription}
              footerText={branding.footerText}
              typeButtons={panel.ticketTypes.map((t) => ({
                label: t.buttonLabel ?? t.name,
                emoji: t.emoji === '' ? undefined : t.emoji,
                style: t.buttonStyle as 'primary' | 'secondary' | 'success' | 'danger',
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-base">Ticket types</CardTitle>
              <CardDescription>Each type renders one button on the panel.</CardDescription>
            </div>
            <Button asChild size="sm">
              <Link href={`/g/${guildId}/panels/${panelId}/types/new`}>Add type</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {panel.ticketTypes.length === 0 ? (
              <p className="text-sm text-[color:var(--color-fg-muted)]">No ticket types yet.</p>
            ) : (
              <ul className="grid gap-2">
                {panel.ticketTypes.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius)] border p-3"
                  >
                    <div className="flex items-center gap-3">
                      {t.emoji !== '' ? <span aria-hidden="true">{t.emoji}</span> : null}
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{t.buttonLabel ?? t.name}</span>
                        <span className="font-mono text-xs text-[color:var(--color-fg-muted)]">
                          {t.name} · {t.supportRoleIds.length} support role
                          {t.supportRoleIds.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/g/${guildId}/panels/${panelId}/types/${t.id}/edit`}>
                          Edit
                        </Link>
                      </Button>
                      <RemoveTypeButton guildId={guildId} typeId={t.id} typeName={t.name} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card destructive>
          <CardHeader>
            <CardTitle className="text-base">Danger zone</CardTitle>
            <CardDescription>
              Permanently delete this panel. The Discord message is removed and the database row is
              dropped. Tickets referencing types on this panel will block deletion.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeletePanelButton guildId={guildId} panelId={panelId} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
