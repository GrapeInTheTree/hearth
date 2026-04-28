'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { removeTicketType } from '@/actions/ticket-types';
import { Button } from '@/components/ui/button';

interface RemoveTypeButtonProps {
  readonly guildId: string;
  readonly typeId: string;
  readonly typeName: string;
}

export function RemoveTypeButton({
  guildId,
  typeId,
  typeName,
}: RemoveTypeButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function handleClick(): Promise<void> {
    if (submitting) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Remove ticket type "${typeName}"?`);
      if (!confirmed) return;
    }
    setSubmitting(true);
    const result = await removeTicketType({ guildId, typeId });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    if (result.value.discordSyncFailed) {
      toast.warning('Removed. Discord re-render queued — retry from the panel detail page.');
    } else {
      toast.success(`Type "${typeName}" removed`);
    }
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
