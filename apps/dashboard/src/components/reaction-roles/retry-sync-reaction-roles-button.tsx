'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { retrySyncReactionRolesPanel } from '@/actions/reaction-roles';
import { Button } from '@/components/ui/button';

interface RetrySyncReactionRolesButtonProps {
  readonly guildId: string;
  readonly panelId: string;
}

export function RetrySyncReactionRolesButton({
  guildId,
  panelId,
}: RetrySyncReactionRolesButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    const result = await retrySyncReactionRolesPanel({ guildId, panelId });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    if (result.value.discordSyncFailed) {
      toast.warning(result.value.discordSyncMessage ?? 'Still failing. Try again later.');
      return;
    }
    toast.success('Self-roles panel synced to Discord');
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
      {submitting ? 'Syncing…' : 'Retry sync'}
    </Button>
  );
}
