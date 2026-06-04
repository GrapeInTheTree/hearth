import type { XWatcherGateway } from '@hearth/tickets-core';
import {
  pollWatcherOnce,
  type PollLogger,
  type PollSummary,
  type XFeedSource,
  type XWatcherService,
} from '@hearth/x-watcher-core';

// In-process scheduler for the X-watcher feature. Hearth runs one bot
// instance per community (no Redis until Phase 4), so a plain setInterval
// with an in-flight guard is the right tool — no distributed lock needed.
//
// Each tick walks every enabled watcher and runs the source-agnostic
// pollWatcherOnce algorithm (see @hearth/x-watcher-core). A failure on one
// watcher never aborts the rest of the tick. `pollOne` exposes the same
// algorithm for the dashboard's on-demand "Poll now" button.

export interface XWatcherPollerDeps {
  readonly service: XWatcherService;
  readonly source: XFeedSource;
  readonly gateway: XWatcherGateway;
  readonly logger: PollLogger;
  readonly intervalMs: number;
}

export class XWatcherPoller {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  public constructor(private readonly deps: XWatcherPollerDeps) {}

  /** Begin periodic polling. No-op when the feed source is disabled
   *  ('none') — there's nothing to poll, so we don't spin a timer. */
  public start(): void {
    if (this.deps.source.name === 'none') {
      this.deps.logger.info('x-watcher: poller idle — no feed source configured');
      return;
    }
    if (this.timer !== null) return;
    const seconds = Math.round(this.deps.intervalMs / 1000);
    this.deps.logger.info(
      `x-watcher: poller started — base tick ${String(seconds)}s, per-watcher cadence from DB (source=${this.deps.source.name})`,
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.intervalMs);
    // Don't keep the event loop alive for the timer alone — graceful
    // shutdown calls stop() explicitly.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One sweep of every enabled watcher. Guarded so a slow tick (many
   *  watchers / slow source) never overlaps the next interval. */
  public async tick(): Promise<void> {
    if (this.ticking) {
      this.deps.logger.warn('x-watcher: skipping tick — previous sweep still running');
      return;
    }
    this.ticking = true;
    try {
      // Per-watcher cadence with a single timer: each base tick only polls
      // the watchers whose own interval has elapsed since lastCheckedAt.
      const watchers = await this.deps.service.getDueWatchers(new Date());
      let posted = 0;
      for (const watcher of watchers) {
        try {
          const summary = await pollWatcherOnce({
            watcher,
            source: this.deps.source,
            gateway: this.deps.gateway,
            service: this.deps.service,
            logger: this.deps.logger,
          });
          posted += summary.posted;
        } catch (error) {
          this.deps.logger.error('x-watcher: watcher poll threw', {
            watcherId: watcher.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (watchers.length > 0) {
        this.deps.logger.info('x-watcher: sweep complete', {
          watchers: watchers.length,
          posted,
        });
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Run one watcher's poll immediately (dashboard "Poll now"). Returns
   *  null when the watcher doesn't exist. */
  public async pollOne(watcherId: string): Promise<PollSummary | null> {
    const result = await this.deps.service.getWatcher(watcherId);
    if (!result.ok) return null;
    return pollWatcherOnce({
      watcher: result.value,
      source: this.deps.source,
      gateway: this.deps.gateway,
      service: this.deps.service,
      logger: this.deps.logger,
    });
  }
}
