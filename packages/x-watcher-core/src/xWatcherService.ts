import {
  and,
  count,
  type DbDrizzle,
  desc,
  eq,
  isNull,
  isUniqueViolation,
  or,
  schema,
  sql,
  type XWatcher,
  type XWatcherEvent,
  type XWatcherEventStatus,
} from '@hearth/database';
import { ConflictError, err, NotFoundError, ok, type Result } from '@hearth/shared';

import { xWatcher as i18n } from './i18n/index.js';

// Persistence layer for X watchers. DB only — no Discord gateway, no
// feed source. The poll algorithm (pollWatcherOnce) orchestrates this
// service together with an XFeedSource and an XWatcherGateway; keeping
// the service pure-DB means the dashboard reuses it freely (it only ever
// does CRUD) and the poll algorithm is testable against a real PGlite
// instance.

export interface XWatcherInput {
  readonly guildId: string;
  /** X handle WITHOUT a leading '@'. The schema layer strips it. */
  readonly sourceHandle: string;
  readonly channelId: string;
  /** Defaults to true (quotes mirrored). */
  readonly includeQuotes?: boolean;
  /** Defaults to false (replies skipped). */
  readonly includeReplies?: boolean;
  /** Defaults to true. */
  readonly enabled?: boolean;
  /** Per-watcher poll cadence (seconds). Defaults to 300 (5 min). */
  readonly pollIntervalSec?: number;
}

// The source account is immutable: changing it would orphan the dedupe
// cursor + resolved user id, so "watch a different account" is a
// delete + recreate, not an edit. Only the destination + toggles change.
export interface XWatcherEditInput {
  readonly channelId?: string;
  readonly includeQuotes?: boolean;
  readonly includeReplies?: boolean;
  readonly enabled?: boolean;
  readonly pollIntervalSec?: number;
}

/** Fields the poller writes when recording one observed post. */
export interface RecordEventInput {
  readonly watcherId: string;
  readonly tweetId: string;
  readonly tweetUrl: string;
  readonly kind: string;
  readonly status: XWatcherEventStatus;
  readonly postedMessageId: string | null;
}

export class XWatcherService {
  public constructor(private readonly db: DbDrizzle) {}

  // ─── CRUD (dashboard + slash) ───────────────────────────────────

  public async createWatcher(input: XWatcherInput): Promise<Result<XWatcher, ConflictError>> {
    try {
      const [created] = await this.db
        .insert(schema.xWatcher)
        .values({
          guildId: input.guildId,
          sourceHandle: input.sourceHandle,
          channelId: input.channelId,
          ...(input.includeQuotes !== undefined ? { includeQuotes: input.includeQuotes } : {}),
          ...(input.includeReplies !== undefined ? { includeReplies: input.includeReplies } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.pollIntervalSec !== undefined
            ? { pollIntervalSec: input.pollIntervalSec }
            : {}),
        })
        .returning();
      if (created === undefined) throw new Error('Failed to insert XWatcher');
      return ok(created);
    } catch (error) {
      // UNIQUE (guildId, sourceHandle, channelId) — the operator already
      // has this exact account → channel binding.
      if (isUniqueViolation(error)) {
        return err(new ConflictError(i18n.errors.duplicateWatcher));
      }
      throw error;
    }
  }

  public async editWatcher(
    watcherId: string,
    input: XWatcherEditInput,
  ): Promise<Result<XWatcher, NotFoundError>> {
    const updates: Partial<typeof schema.xWatcher.$inferInsert> = {};
    if (input.channelId !== undefined) updates.channelId = input.channelId;
    if (input.includeQuotes !== undefined) updates.includeQuotes = input.includeQuotes;
    if (input.includeReplies !== undefined) updates.includeReplies = input.includeReplies;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    if (input.pollIntervalSec !== undefined) updates.pollIntervalSec = input.pollIntervalSec;

    if (Object.keys(updates).length === 0) {
      const existing = await this.getWatcherRow(watcherId);
      if (existing === undefined) return err(new NotFoundError(i18n.errors.watcherNotFound));
      return ok(existing);
    }

    const [updated] = await this.db
      .update(schema.xWatcher)
      .set(updates)
      .where(eq(schema.xWatcher.id, watcherId))
      .returning();
    if (updated === undefined) return err(new NotFoundError(i18n.errors.watcherNotFound));
    return ok(updated);
  }

  public async setEnabled(
    watcherId: string,
    enabled: boolean,
  ): Promise<Result<XWatcher, NotFoundError>> {
    return this.editWatcher(watcherId, { enabled });
  }

  public listWatchers(guildId: string): Promise<XWatcher[]> {
    return this.db
      .select()
      .from(schema.xWatcher)
      .where(eq(schema.xWatcher.guildId, guildId))
      .orderBy(desc(schema.xWatcher.createdAt));
  }

  public async getWatcher(watcherId: string): Promise<Result<XWatcher, NotFoundError>> {
    const row = await this.getWatcherRow(watcherId);
    if (row === undefined) return err(new NotFoundError(i18n.errors.watcherNotFound));
    return ok(row);
  }

  public async deleteWatcher(
    watcherId: string,
  ): Promise<Result<{ watcherId: string }, NotFoundError>> {
    const [deleted] = await this.db
      .delete(schema.xWatcher)
      .where(eq(schema.xWatcher.id, watcherId))
      .returning({ id: schema.xWatcher.id });
    if (deleted === undefined) return err(new NotFoundError(i18n.errors.watcherNotFound));
    return ok({ watcherId: deleted.id });
  }

  // ─── poller support (pollWatcherOnce calls these) ───────────────

  /** Every enabled watcher across all guilds this bot serves. */
  public getEnabledWatchers(): Promise<XWatcher[]> {
    return this.db.select().from(schema.xWatcher).where(eq(schema.xWatcher.enabled, true));
  }

  /**
   * Enabled watchers that are DUE for a poll as of `now` — i.e. never
   * checked, or `lastCheckedAt + pollIntervalSec` has elapsed. This is the
   * poller's per-tick work list: the bot ticks on a fixed base cadence and
   * each tick only polls the watchers whose own interval has come round,
   * giving per-watcher cadence with a single timer. `now` is passed in
   * (not SQL now()) so the due logic is deterministically testable.
   */
  public getDueWatchers(now: Date): Promise<XWatcher[]> {
    return this.db
      .select()
      .from(schema.xWatcher)
      .where(
        and(
          eq(schema.xWatcher.enabled, true),
          or(
            isNull(schema.xWatcher.lastCheckedAt),
            sql`${schema.xWatcher.lastCheckedAt} + (${schema.xWatcher.pollIntervalSec} * interval '1 second') <= ${now}`,
          ),
        ),
      );
  }

  /** Persist the lazily-resolved X numeric user id so later polls skip
   *  the resolution round-trip. */
  public async setSourceUserId(watcherId: string, sourceUserId: string): Promise<void> {
    await this.db
      .update(schema.xWatcher)
      .set({ sourceUserId })
      .where(eq(schema.xWatcher.id, watcherId));
  }

  /** Mark a poll completed without advancing the cursor (empty result or
   *  unresolved handle). */
  public async markChecked(watcherId: string): Promise<void> {
    await this.db
      .update(schema.xWatcher)
      .set({ lastCheckedAt: new Date() })
      .where(eq(schema.xWatcher.id, watcherId));
  }

  /** Advance the dedupe cursor and stamp the check time. */
  public async markPolled(watcherId: string, lastTweetId: string): Promise<void> {
    await this.db
      .update(schema.xWatcher)
      .set({ lastTweetId, lastCheckedAt: new Date() })
      .where(eq(schema.xWatcher.id, watcherId));
  }

  /** Append one ledger row. Idempotent: a duplicate (watcherId, tweetId)
   *  — from an overlapping tick or retry — is swallowed so a post is
   *  never recorded (nor mirrored) twice. */
  public async recordEvent(input: RecordEventInput): Promise<void> {
    try {
      await this.db.insert(schema.xWatcherEvent).values({
        watcherId: input.watcherId,
        tweetId: input.tweetId,
        tweetUrl: input.tweetUrl,
        kind: input.kind,
        status: input.status,
        postedMessageId: input.postedMessageId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) return;
      throw error;
    }
  }

  // ─── audit reads (dashboard) ────────────────────────────────────

  public listEvents(watcherId: string, limit = 20): Promise<XWatcherEvent[]> {
    return this.db
      .select()
      .from(schema.xWatcherEvent)
      .where(eq(schema.xWatcherEvent.watcherId, watcherId))
      .orderBy(desc(schema.xWatcherEvent.createdAt))
      .limit(limit);
  }

  public async countEvents(watcherId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.xWatcherEvent)
      .where(eq(schema.xWatcherEvent.watcherId, watcherId));
    return row?.value ?? 0;
  }

  /** Count of successfully mirrored posts — the dashboard's headline
   *  "posts mirrored" stat for a watcher. */
  public async countPosted(watcherId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.xWatcherEvent)
      .where(
        and(
          eq(schema.xWatcherEvent.watcherId, watcherId),
          eq(schema.xWatcherEvent.status, 'posted'),
        ),
      );
    return row?.value ?? 0;
  }

  // ─────────────────────────── private ───────────────────────────

  private async getWatcherRow(watcherId: string): Promise<XWatcher | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.xWatcher)
      .where(eq(schema.xWatcher.id, watcherId))
      .limit(1);
    return row;
  }
}
