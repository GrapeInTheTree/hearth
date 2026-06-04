'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { pollWatcherNow } from '@/actions/x-watcher';
import { Button } from '@/components/ui/button';

interface PollNowButtonProps {
  readonly guildId: string;
  readonly watcherId: string;
}

// On-demand trigger — runs this watcher's poll immediately instead of
// waiting for the interval. Reports what happened from the bot's summary.
export function PollNowButton({ guildId, watcherId }: PollNowButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    const result = await pollWatcherNow({ guildId, watcherId });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    const s = result.value;
    if (s.unresolved) {
      toast.warning(
        'Could not reach the X account — check the handle, or no feed source is configured yet.',
      );
    } else if (s.seeded) {
      toast.success('Watcher primed — future posts from now on will be mirrored.');
    } else if (s.posted > 0) {
      toast.success(`Mirrored ${String(s.posted)} new post${s.posted === 1 ? '' : 's'}.`);
    } else {
      toast.success('Up to date — nothing new to mirror.');
    }
    router.refresh();
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        void handleClick();
      }}
      disabled={submitting}
    >
      <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      {submitting ? 'Polling…' : 'Poll now'}
    </Button>
  );
}
