'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { deleteSelfRolesPanel } from '@/actions/self-roles';
import { Button } from '@/components/ui/button';

interface DeleteSelfRolesButtonProps {
  readonly guildId: string;
  readonly panelId: string;
}

export function DeleteSelfRolesButton({
  guildId,
  panelId,
}: DeleteSelfRolesButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick(): Promise<void> {
    if (submitting) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'Delete this self-roles panel? The Discord message, options, and audit log are removed permanently. Existing role grants on users stay until you remove them manually.',
      );
      if (!confirmed) return;
    }
    setSubmitting(true);
    const result = await deleteSelfRolesPanel({ guildId, panelId });
    if (!result.ok) {
      toast.error(result.error.message);
      setSubmitting(false);
      return;
    }
    toast.success('Self-roles panel deleted');
    router.push(`/g/${guildId}/self-roles`);
    router.refresh();
  }

  return (
    <Button
      variant="danger"
      onClick={() => {
        void handleClick();
      }}
      disabled={submitting}
    >
      {submitting ? 'Deleting…' : 'Delete panel'}
    </Button>
  );
}
