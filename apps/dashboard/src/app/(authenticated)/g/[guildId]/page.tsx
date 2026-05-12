import {
  and,
  count,
  countDistinct,
  dbDrizzle,
  desc,
  eq,
  inArray,
  schema,
  ReactionRolesAction,
  TicketStatus,
  VerificationOutcome,
} from '@hearth/database';
import {
  Activity,
  CheckCircle2,
  CircleSlash2,
  Inbox,
  Languages,
  MinusCircle,
  PlusCircle,
  Settings as SettingsIcon,
  ShieldCheck,
  Tag,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';

import { Topbar } from '@/components/layout/topbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';
import { auth } from '@/lib/auth';
import { relativeTime } from '@/lib/format';

interface GuildOverviewPageProps {
  readonly params: Promise<{ readonly guildId: string }>;
}

const ACTIVITY_LIMIT = 8;

interface ActivityRow {
  readonly id: string;
  readonly kind: 'ticket' | 'verification' | 'reaction-roles';
  /** Display label, formatted with i18n template. */
  readonly label: string;
  /** Pre-resolved ticket number / outcome for the icon. */
  readonly icon:
    | 'opened'
    | 'claimed'
    | 'closed'
    | 'reopened'
    | 'deleted'
    | 'success'
    | 'wrong'
    | 'already'
    | 'failed'
    | 'granted'
    | 'revoked';
  readonly createdAt: Date;
}

function formatTicketEvent(
  type: string,
  number: number,
): { label: string; icon: ActivityRow['icon'] } {
  const numberStr = String(number);
  const tplVars = (s: string): string => s.replace('{number}', numberStr);
  switch (type) {
    case 'opened':
      return { label: tplVars(t.overview.activity.ticketOpened), icon: 'opened' };
    case 'claimed':
      return { label: tplVars(t.overview.activity.ticketClaimed), icon: 'claimed' };
    case 'closed':
      return { label: tplVars(t.overview.activity.ticketClosed), icon: 'closed' };
    case 'reopened':
      return { label: tplVars(t.overview.activity.ticketReopened), icon: 'reopened' };
    case 'deleted':
      return { label: tplVars(t.overview.activity.ticketDeleted), icon: 'deleted' };
    case 'channel-deleted':
      return { label: tplVars(t.overview.activity.ticketChannelDeleted), icon: 'deleted' };
    default:
      return { label: `${type} #${numberStr}`, icon: 'opened' };
  }
}

function formatVerificationEvent(outcome: string): { label: string; icon: ActivityRow['icon'] } {
  switch (outcome) {
    case VerificationOutcome.success:
      return { label: t.overview.activity.verificationSuccess, icon: 'success' };
    case VerificationOutcome.wrongAnswer:
      return { label: t.overview.activity.verificationWrong, icon: 'wrong' };
    case VerificationOutcome.alreadyVerified:
      return { label: t.overview.activity.verificationAlready, icon: 'already' };
    case VerificationOutcome.roleAssignFailed:
      return { label: t.overview.activity.verificationFailed, icon: 'failed' };
    default:
      return { label: outcome, icon: 'failed' };
  }
}

function formatReactionRolesEvent(action: string): { label: string; icon: ActivityRow['icon'] } {
  switch (action) {
    case ReactionRolesAction.granted:
      return { label: t.overview.activity.reactionRolesGranted, icon: 'granted' };
    case ReactionRolesAction.revoked:
      return { label: t.overview.activity.reactionRolesRevoked, icon: 'revoked' };
    case ReactionRolesAction.noop:
      return { label: t.overview.activity.reactionRolesNoop, icon: 'failed' };
    default:
      return { label: action, icon: 'failed' };
  }
}

export default async function GuildOverviewPage({
  params,
}: GuildOverviewPageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (session === null) return <></>;

  const { guildId } = await params;

  // All counts + activity feed in a single round trip — overview should
  // load fast even on a sluggish bot. No /internal/* calls; everything is
  // straight DB reads.
  const [
    ticketPanelsRows,
    openTicketsRows,
    closedTicketsRows,
    verificationPanelsRows,
    verifiedUsersRows,
    reactionRolesPanelsRows,
    reactionRolesActiveHoldersRows,
    recentTicketEvents,
    recentVerificationEvents,
    recentReactionRolesEvents,
  ] = await Promise.all([
    dbDrizzle
      .select({ value: count() })
      .from(schema.panel)
      .where(eq(schema.panel.guildId, guildId)),
    dbDrizzle
      .select({ value: count() })
      .from(schema.ticket)
      .where(
        and(
          eq(schema.ticket.guildId, guildId),
          inArray(schema.ticket.status, [TicketStatus.open, TicketStatus.claimed]),
        ),
      ),
    dbDrizzle
      .select({ value: count() })
      .from(schema.ticket)
      .where(
        and(eq(schema.ticket.guildId, guildId), eq(schema.ticket.status, TicketStatus.closed)),
      ),
    dbDrizzle
      .select({ value: count() })
      .from(schema.verificationPanel)
      .where(eq(schema.verificationPanel.guildId, guildId)),
    // distinct(userId) WHERE outcome=success — counts unique users who
    // successfully verified in any panel of this guild. Re-clicks
    // ('already_verified') don't inflate this number.
    dbDrizzle
      .select({ value: countDistinct(schema.verificationEvent.userId) })
      .from(schema.verificationEvent)
      .innerJoin(
        schema.verificationPanel,
        eq(schema.verificationPanel.id, schema.verificationEvent.panelId),
      )
      .where(
        and(
          eq(schema.verificationPanel.guildId, guildId),
          eq(schema.verificationEvent.outcome, VerificationOutcome.success),
        ),
      ),
    dbDrizzle
      .select({ value: count() })
      .from(schema.reactionRolesPanel)
      .where(eq(schema.reactionRolesPanel.guildId, guildId)),
    // Active holders = distinct users with at least one net-positive
    // role binding across any option of this guild's reaction-roles
    // panels. We can't compute "net granted - revoked" in pure SQL
    // without a window function, so we go for an upper-bound proxy:
    // distinct(userId) WHERE action='granted'. Re-grants don't inflate
    // (countDistinct) but users who later revoked are still counted.
    // Good enough for an overview card; the panel detail page has the
    // exact audit-log walk.
    dbDrizzle
      .select({ value: countDistinct(schema.reactionRolesEvent.userId) })
      .from(schema.reactionRolesEvent)
      .innerJoin(
        schema.reactionRolesPanel,
        eq(schema.reactionRolesPanel.id, schema.reactionRolesEvent.panelId),
      )
      .where(
        and(
          eq(schema.reactionRolesPanel.guildId, guildId),
          eq(schema.reactionRolesEvent.action, ReactionRolesAction.granted),
        ),
      ),
    dbDrizzle
      .select({
        id: schema.ticketEvent.id,
        type: schema.ticketEvent.type,
        createdAt: schema.ticketEvent.createdAt,
        ticketNumber: schema.ticket.number,
      })
      .from(schema.ticketEvent)
      .innerJoin(schema.ticket, eq(schema.ticket.id, schema.ticketEvent.ticketId))
      .where(eq(schema.ticket.guildId, guildId))
      .orderBy(desc(schema.ticketEvent.createdAt))
      .limit(ACTIVITY_LIMIT),
    dbDrizzle
      .select({
        id: schema.verificationEvent.id,
        outcome: schema.verificationEvent.outcome,
        createdAt: schema.verificationEvent.createdAt,
      })
      .from(schema.verificationEvent)
      .innerJoin(
        schema.verificationPanel,
        eq(schema.verificationPanel.id, schema.verificationEvent.panelId),
      )
      .where(eq(schema.verificationPanel.guildId, guildId))
      .orderBy(desc(schema.verificationEvent.createdAt))
      .limit(ACTIVITY_LIMIT),
    dbDrizzle
      .select({
        id: schema.reactionRolesEvent.id,
        action: schema.reactionRolesEvent.action,
        createdAt: schema.reactionRolesEvent.createdAt,
      })
      .from(schema.reactionRolesEvent)
      .innerJoin(
        schema.reactionRolesPanel,
        eq(schema.reactionRolesPanel.id, schema.reactionRolesEvent.panelId),
      )
      .where(eq(schema.reactionRolesPanel.guildId, guildId))
      .orderBy(desc(schema.reactionRolesEvent.createdAt))
      .limit(ACTIVITY_LIMIT),
  ]);

  const ticketPanels = ticketPanelsRows[0]?.value ?? 0;
  const openTickets = openTicketsRows[0]?.value ?? 0;
  const closedTickets = closedTicketsRows[0]?.value ?? 0;
  const verificationPanels = verificationPanelsRows[0]?.value ?? 0;
  const verifiedUsers = verifiedUsersRows[0]?.value ?? 0;
  const reactionRolesPanelsCount = reactionRolesPanelsRows[0]?.value ?? 0;
  const reactionRolesActiveHolders = reactionRolesActiveHoldersRows[0]?.value ?? 0;

  // Merge + sort the three activity streams by createdAt, take the most
  // recent ACTIVITY_LIMIT. Smaller streams just contribute fewer rows.
  const merged: ActivityRow[] = [
    ...recentTicketEvents.map((e) => {
      const { label, icon } = formatTicketEvent(e.type, e.ticketNumber);
      return { id: e.id, kind: 'ticket' as const, label, icon, createdAt: e.createdAt };
    }),
    ...recentVerificationEvents.map((e) => {
      const { label, icon } = formatVerificationEvent(e.outcome);
      return { id: e.id, kind: 'verification' as const, label, icon, createdAt: e.createdAt };
    }),
    ...recentReactionRolesEvents.map((e) => {
      const { label, icon } = formatReactionRolesEvent(e.action);
      return { id: e.id, kind: 'reaction-roles' as const, label, icon, createdAt: e.createdAt };
    }),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, ACTIVITY_LIMIT);

  const isEmpty = ticketPanels === 0 && verificationPanels === 0 && reactionRolesPanelsCount === 0;

  const avatarUrl =
    session.user.avatarHash !== null
      ? `https://cdn.discordapp.com/avatars/${session.user.discordId}/${session.user.avatarHash}.webp?size=128`
      : null;

  return (
    <>
      <Topbar
        username={session.user.username}
        avatarUrl={avatarUrl}
        title={t.overview.title}
        description={t.overview.description}
        action={
          <Button asChild>
            <Link href={`/g/${guildId}/panels/new`}>{t.overview.quickActions.newTicketPanel}</Link>
          </Button>
        }
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-8 py-12">
        {/* KPI grid — primary stats at a glance. 7 cards lay out as 2
            cols on mobile, 4 on md, 7 on xl. Reads horizontally as
            three logical groups: Tickets (3) · Verification (2) ·
            Self-roles (2). */}
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          <StatCard
            href={`/g/${guildId}/panels`}
            icon={Tag}
            label={t.overview.counts.ticketPanels}
            value={ticketPanels}
          />
          <StatCard
            href={`/g/${guildId}/tickets?status=open`}
            icon={Inbox}
            label={t.overview.counts.openTickets}
            value={openTickets}
          />
          <StatCard
            href={`/g/${guildId}/tickets?status=closed`}
            icon={Inbox}
            label={t.overview.counts.closedTickets}
            value={closedTickets}
            muted
          />
          <StatCard
            href={`/g/${guildId}/verification`}
            icon={ShieldCheck}
            label={t.overview.counts.verificationPanels}
            value={verificationPanels}
          />
          <StatCard
            href={`/g/${guildId}/verification`}
            icon={CheckCircle2}
            label={t.overview.counts.verifiedUsers}
            value={verifiedUsers}
            muted
          />
          <StatCard
            href={`/g/${guildId}/reaction-roles`}
            icon={Languages}
            label={t.overview.counts.reactionRolesPanels}
            value={reactionRolesPanelsCount}
          />
          <StatCard
            href={`/g/${guildId}/reaction-roles`}
            icon={CheckCircle2}
            label={t.overview.counts.reactionRolesActiveHolders}
            value={reactionRolesActiveHolders}
            muted
          />
        </div>

        {/* Get-started cards (only when guild has no content). */}
        {isEmpty ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.overview.sections.quickStart}</CardTitle>
              <CardDescription>{t.overview.sections.quickStartHint}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href={`/g/${guildId}/panels/new`}>
                  {t.overview.quickActions.newTicketPanel}
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href={`/g/${guildId}/verification/new`}>
                  {t.overview.quickActions.newVerificationPanel}
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href={`/g/${guildId}/settings`}>
                  <SettingsIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t.overview.quickActions.viewSettings}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {/* Recent activity — combined ticket + verification events. */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" aria-hidden="true" />
              {t.overview.sections.activity}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {merged.length === 0 ? (
              <p className="text-sm text-[color:var(--color-fg-muted)]">
                {t.overview.sections.activityEmpty}
              </p>
            ) : (
              <ul className="divide-y divide-[color:var(--color-border)]">
                {merged.map((row) => (
                  <li
                    key={`${row.kind}-${row.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ActivityIcon icon={row.icon} />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <time
                      className="shrink-0 text-xs text-[color:var(--color-fg-muted)]"
                      dateTime={row.createdAt.toISOString()}
                    >
                      {relativeTime(row.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}

interface StatCardProps {
  readonly href: string;
  readonly icon: typeof Tag;
  readonly label: string;
  readonly value: number;
  readonly muted?: boolean;
}

function StatCard({
  href,
  icon: Icon,
  label,
  value,
  muted = false,
}: StatCardProps): React.JSX.Element {
  return (
    <Link
      href={href}
      className="group rounded-[var(--radius-lg)] border bg-[color:var(--color-bg)] p-4 transition-colors duration-[var(--duration-fast)] hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-bg-subtle)]"
    >
      <div className="flex items-center gap-2 text-xs text-[color:var(--color-fg-muted)]">
        <Icon
          className={
            muted
              ? 'h-3.5 w-3.5 text-[color:var(--color-fg-muted)]'
              : 'h-3.5 w-3.5 text-[color:var(--color-accent)]'
          }
          aria-hidden="true"
        />
        <span>{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
    </Link>
  );
}

function ActivityIcon({ icon }: { readonly icon: ActivityRow['icon'] }): React.JSX.Element {
  // Color + glyph picked per outcome to make the feed scannable.
  switch (icon) {
    case 'opened':
    case 'claimed':
    case 'reopened':
      return <Inbox className="h-3.5 w-3.5 text-[color:var(--color-accent)]" aria-hidden="true" />;
    case 'closed':
      return (
        <CheckCircle2
          className="h-3.5 w-3.5 text-[color:var(--color-fg-muted)]"
          aria-hidden="true"
        />
      );
    case 'deleted':
      return (
        <XCircle className="h-3.5 w-3.5 text-[color:var(--color-fg-muted)]" aria-hidden="true" />
      );
    case 'success':
      return (
        <CheckCircle2
          className="h-3.5 w-3.5 text-[color:var(--color-success,_#3BA55D)]"
          aria-hidden="true"
        />
      );
    case 'wrong':
      return (
        <XCircle className="h-3.5 w-3.5 text-[color:var(--color-fg-muted)]" aria-hidden="true" />
      );
    case 'already':
      return (
        <CircleSlash2
          className="h-3.5 w-3.5 text-[color:var(--color-fg-muted)]"
          aria-hidden="true"
        />
      );
    case 'failed':
      return (
        <XCircle
          className="h-3.5 w-3.5 text-[color:var(--color-danger,_#ED4245)]"
          aria-hidden="true"
        />
      );
    case 'granted':
      return (
        <PlusCircle
          className="h-3.5 w-3.5 text-[color:var(--color-success,_#3BA55D)]"
          aria-hidden="true"
        />
      );
    case 'revoked':
      return (
        <MinusCircle
          className="h-3.5 w-3.5 text-[color:var(--color-fg-muted)]"
          aria-hidden="true"
        />
      );
  }
}
