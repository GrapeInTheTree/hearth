import { XWatcherEventStatus, type XWatcher } from '@hearth/database';
import { DiscordApiError } from '@hearth/shared';
import type { XWatcherGateway } from '@hearth/tickets-core';

import type { XFeedSource } from '../ports/xFeedSource.js';
import type { XWatcherService } from '../xWatcherService.js';

import { classifyPost } from './classifyPost.js';
import { compareTweetId } from './tweetId.js';

// The poll algorithm — one watcher, one tick. Orchestrates the three
// collaborators (source / service / gateway) but holds no I/O itself, so
// it's fully testable with a fake source + fake gateway over a real
// PGlite service.
//
// Flow:
//   1. Resolve the X user id if we don't have it yet (persist it).
//   2. Ask the source for posts newer than the cursor.
//   3. FIRST POLL (cursor null): seed the cursor to the newest id and
//      post nothing — never backfill an account's history into a channel.
//   4. Otherwise, oldest-first: classify each post, mirror the postable
//      ones as bare links, record every observation in the ledger, and
//      advance the cursor past each — even a send that failed, so one
//      bad post can't wedge the feed forever.

export interface PollLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface PollWatcherDeps {
  readonly watcher: XWatcher;
  readonly source: XFeedSource;
  readonly gateway: XWatcherGateway;
  readonly service: XWatcherService;
  readonly logger?: PollLogger;
}

export interface PollSummary {
  readonly watcherId: string;
  /** First poll: cursor seeded, nothing posted. */
  readonly seeded: boolean;
  /** Handle couldn't be resolved this tick (typo / suspended / no source). */
  readonly unresolved: boolean;
  readonly posted: number;
  readonly skipped: number;
  readonly failed: number;
  /** Cursor after this tick (unchanged on unresolved). */
  readonly newCursor: string | null;
}

export async function pollWatcherOnce(deps: PollWatcherDeps): Promise<PollSummary> {
  const { watcher, source, gateway, service, logger } = deps;
  const base = { watcherId: watcher.id, posted: 0, skipped: 0, failed: 0 };

  // 1. Resolve the X user id if missing, and persist it.
  let userId = watcher.sourceUserId;
  if (userId === null) {
    const resolved = await source.resolveUser(watcher.sourceHandle);
    if (resolved === null) {
      logger?.warn('x-watcher: handle did not resolve', {
        watcherId: watcher.id,
        handle: watcher.sourceHandle,
        source: source.name,
      });
      await service.markChecked(watcher.id);
      return { ...base, seeded: false, unresolved: true, newCursor: watcher.lastTweetId };
    }
    userId = resolved.userId;
    await service.setSourceUserId(watcher.id, userId);
  }

  // 2. Fetch posts newer than the cursor.
  const fetched = await source.fetchSince(userId, watcher.lastTweetId);
  const ordered = [...fetched].sort((a, b) => compareTweetId(a.id, b.id));

  // 3. First poll → seed the cursor, post nothing.
  if (watcher.lastTweetId === null) {
    const newest = ordered.at(-1)?.id ?? null;
    if (newest !== null) {
      await service.markPolled(watcher.id, newest);
    } else {
      await service.markChecked(watcher.id);
    }
    logger?.info('x-watcher: seeded cursor on first poll', {
      watcherId: watcher.id,
      handle: watcher.sourceHandle,
      cursor: newest,
    });
    return { ...base, seeded: true, unresolved: false, newCursor: newest };
  }

  // 4. Mirror postable items oldest-first; advance the cursor past each.
  let cursor = watcher.lastTweetId;
  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of ordered) {
    // Belt-and-braces: the source asked for newer-than-cursor, but never
    // trust it — skip anything at or behind the cursor.
    if (compareTweetId(item.id, cursor) <= 0) continue;

    const decision = classifyPost(item, {
      includeQuotes: watcher.includeQuotes,
      includeReplies: watcher.includeReplies,
    });

    if (decision.post) {
      try {
        const { messageId } = await gateway.sendChannelMessage(watcher.channelId, item.url);
        await service.recordEvent({
          watcherId: watcher.id,
          tweetId: item.id,
          tweetUrl: item.url,
          kind: item.kind,
          status: XWatcherEventStatus.posted,
          postedMessageId: messageId,
        });
        posted += 1;
      } catch (error) {
        // Discord rejected the send (channel gone / missing perms / rate
        // limit). Record it and move on — advancing the cursor below
        // means we won't retry this post forever. Non-Discord errors are
        // genuine bugs and propagate.
        if (!(error instanceof DiscordApiError)) throw error;
        logger?.error('x-watcher: send failed', {
          watcherId: watcher.id,
          channelId: watcher.channelId,
          tweetId: item.id,
          reason: error.message,
        });
        await service.recordEvent({
          watcherId: watcher.id,
          tweetId: item.id,
          tweetUrl: item.url,
          kind: item.kind,
          status: XWatcherEventStatus.sendFailed,
          postedMessageId: null,
        });
        failed += 1;
      }
    } else {
      await service.recordEvent({
        watcherId: watcher.id,
        tweetId: item.id,
        tweetUrl: item.url,
        kind: item.kind,
        status: decision.status,
        postedMessageId: null,
      });
      skipped += 1;
    }

    cursor = item.id;
  }

  if (cursor !== watcher.lastTweetId) {
    await service.markPolled(watcher.id, cursor);
  } else {
    await service.markChecked(watcher.id);
  }

  return {
    watcherId: watcher.id,
    seeded: false,
    unresolved: false,
    posted,
    skipped,
    failed,
    newCursor: cursor,
  };
}
