'use client';

import { Pause, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { setWatcherEnabled } from '@/actions/x-watcher';
import { Button } from '@/components/ui/button';

interface ToggleEnabledButtonProps {
  readonly guildId: string;
  readonly watcherId: string;
  readonly enabled: boolean;
}

// Pause / resume a watcher without deleting it. Pausing keeps the dedupe
// cursor, so resuming later doesn't backfill the gap.
export function ToggleEnabledButton({
  guildId,
  watcherId,
  enabled,
}: ToggleEnabledButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    const result = await setWatcherEnabled({ guildId, watcherId, enabled: !enabled });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(result.value.enabled ? 'Watcher resumed' : 'Watcher paused');
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
      {enabled ? (
        <Pause className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      )}
      {enabled ? 'Pause' : 'Resume'}
    </Button>
  );
}
