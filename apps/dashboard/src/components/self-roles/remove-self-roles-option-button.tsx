'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { removeSelfRolesOption } from '@/actions/self-roles-options';
import { Button } from '@/components/ui/button';

interface RemoveSelfRolesOptionButtonProps {
  readonly guildId: string;
  readonly panelId: string;
  readonly optionId: string;
  readonly optionLabel: string;
}

export function RemoveSelfRolesOptionButton({
  guildId,
  panelId,
  optionId,
  optionLabel,
}: RemoveSelfRolesOptionButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick(): Promise<void> {
    if (submitting) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        `Remove option "${optionLabel}"? You'll need to repost the panel to push the change to Discord. Users who already hold the role keep it.`,
      );
      if (!confirmed) return;
    }
    setSubmitting(true);
    const result = await removeSelfRolesOption({ guildId, panelId, optionId });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Option removed');
    router.refresh();
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void handleClick();
      }}
      disabled={submitting}
    >
      {submitting ? 'Removing…' : 'Remove'}
    </Button>
  );
}
