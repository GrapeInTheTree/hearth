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
      "Repost will delete the existing Discord message and post a fresh one at the bottom of the channel.\n\n• Users keep their roles (role grants are member-level, not message-level).\n• Their visible reaction state on the old message is lost — they'll need to re-react to toggle off.\n\nFor adding or editing options you usually do NOT need this — edits sync to the existing message automatically. Use Repost only when you want the panel to surface at the bottom of the channel again.",
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
