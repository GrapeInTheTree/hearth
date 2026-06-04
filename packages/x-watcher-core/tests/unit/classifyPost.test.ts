import { XWatcherEventStatus } from '@hearth/database';
import { describe, expect, it } from 'vitest';

import { classifyPost } from '../../src/lib/classifyPost.js';
import { tweet } from '../helpers/fakeXFeedSource.js';

// Pure rules. Retweets always skipped; replies/quotes gated by toggles;
// originals always posted. This is the single source of truth for the
// include/exclude policy, so it gets exhaustive coverage.

const both = { includeQuotes: true, includeReplies: true };
const neither = { includeQuotes: false, includeReplies: false };
const defaults = { includeQuotes: true, includeReplies: false };

describe('classifyPost', () => {
  it('always posts an original, regardless of toggles', () => {
    expect(classifyPost(tweet('100', 'original'), neither)).toEqual({ post: true });
    expect(classifyPost(tweet('100', 'original'), both)).toEqual({ post: true });
  });

  it('never posts a retweet, regardless of toggles', () => {
    expect(classifyPost(tweet('100', 'retweet'), both)).toEqual({
      post: false,
      status: XWatcherEventStatus.skippedRetweet,
    });
    expect(classifyPost(tweet('100', 'retweet'), neither)).toEqual({
      post: false,
      status: XWatcherEventStatus.skippedRetweet,
    });
  });

  it('posts a quote by default; skips it when includeQuotes is false', () => {
    expect(classifyPost(tweet('100', 'quote'), defaults)).toEqual({ post: true });
    expect(classifyPost(tweet('100', 'quote'), neither)).toEqual({
      post: false,
      status: XWatcherEventStatus.skippedQuote,
    });
  });

  it('skips a reply by default; posts it when includeReplies is true', () => {
    expect(classifyPost(tweet('100', 'reply'), defaults)).toEqual({
      post: false,
      status: XWatcherEventStatus.skippedReply,
    });
    expect(classifyPost(tweet('100', 'reply'), both)).toEqual({ post: true });
  });
});
