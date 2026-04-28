'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { deletePanel } from '@/actions/panels';
import { Button } from '@/components/ui/button';

interface DeletePanelButtonProps {
  readonly guildId: string;
  readonly panelId: string;
}

export function DeletePanelButton({ guildId, panelId }: DeletePanelButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick(): Promise<void> {
    if (submitting) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'Delete this panel? The Discord message and database row are removed permanently.',
      );
      if (!confirmed) return;
    }
    setSubmitting(true);
    const result = await deletePanel({ guildId, panelId });
    if (!result.ok) {
      toast.error(result.error.message);
      setSubmitting(false);
      return;
    }
    toast.success('Panel deleted');
    router.push(`/g/${guildId}/panels`);
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
