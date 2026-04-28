'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { retrySyncPanel } from '@/actions/panels';
import { Button } from '@/components/ui/button';

interface RetrySyncButtonProps {
  readonly guildId: string;
  readonly panelId: string;
}

export function RetrySyncButton({ guildId, panelId }: RetrySyncButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    const result = await retrySyncPanel({ guildId, panelId });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    if (result.value.discordSyncFailed) {
      toast.warning(result.value.discordSyncMessage ?? 'Discord still unreachable. Try again.');
      return;
    }
    toast.success('Synced to Discord');
    router.refresh();
  }

  return (
    <Button
      variant="secondary"
      onClick={() => {
        void handleClick();
      }}
      disabled={submitting}
    >
      {submitting ? 'Syncing…' : 'Retry sync'}
    </Button>
  );
}
