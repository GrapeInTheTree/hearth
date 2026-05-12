'use client';

import { AlertTriangle, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { deleteReactionRolesPanel } from '@/actions/reaction-roles';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface DeleteReactionRolesButtonProps {
  readonly guildId: string;
  readonly panelId: string;
}

export function DeleteReactionRolesButton({
  guildId,
  panelId,
}: DeleteReactionRolesButtonProps): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleConfirm(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    const result = await deleteReactionRolesPanel({ guildId, panelId });
    if (!result.ok) {
      toast.error(result.error.message);
      setSubmitting(false);
      return;
    }
    toast.success('Self-roles panel deleted');
    router.push(`/g/${guildId}/reaction-roles`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger">
          <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Delete panel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this reaction-roles panel?</DialogTitle>
          <DialogDescription>
            The Discord message, options, and audit log are removed permanently.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5 text-sm">
          <li className="flex items-start gap-2">
            <span
              className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-accent)]"
              aria-hidden="true"
            />
            <span>
              <span className="font-medium">Existing role grants stay on members.</span>{' '}
              <span className="text-[color:var(--color-fg-muted)]">
                Roles are member-level — to revoke, use the per-option cleanup before deleting.
              </span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span
              className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-danger)]"
              aria-hidden="true"
            />
            <span>
              <span className="font-medium">The audit log is gone.</span>{' '}
              <span className="text-[color:var(--color-fg-muted)]">
                Granted / revoked / noop events for this panel are deleted.
              </span>
            </span>
          </li>
        </ul>

        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/5 p-3 text-xs">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-danger)]"
            aria-hidden="true"
          />
          <p>This cannot be undone.</p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="danger"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={submitting}
          >
            {submitting ? 'Deleting…' : 'Delete panel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
