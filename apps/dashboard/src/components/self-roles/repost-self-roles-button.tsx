'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { repostSelfRolesPanel } from '@/actions/self-roles';
import { Button } from '@/components/ui/button';

interface RepostSelfRolesButtonProps {
  readonly guildId: string;
  readonly panelId: string;
}

export function RepostSelfRolesButton({
  guildId,
  panelId,
}: RepostSelfRolesButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick(): Promise<void> {
    if (submitting) return;
    const ok = window.confirm(
      'Repost the self-roles panel? The existing Discord message will be deleted and a new one will appear at the bottom of the channel with the reaction strip re-seeded. Existing role grants on users stay.',
    );
    if (!ok) return;
    setSubmitting(true);
    const result = await repostSelfRolesPanel({ guildId, panelId });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    if (result.value.discordSyncFailed) {
      toast.warning(result.value.discordSyncMessage ?? 'Discord unreachable. Try again.');
      return;
    }
    toast.success('Self-roles panel reposted to channel');
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
      {submitting ? 'Reposting…' : 'Repost to channel'}
    </Button>
  );
}
