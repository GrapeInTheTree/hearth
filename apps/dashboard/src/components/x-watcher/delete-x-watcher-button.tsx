'use client';

import { AlertTriangle, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { deleteWatcher } from '@/actions/x-watcher';
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

interface DeleteXWatcherButtonProps {
  readonly guildId: string;
  readonly watcherId: string;
  readonly handle: string;
}

export function DeleteXWatcherButton({
  guildId,
  watcherId,
  handle,
}: DeleteXWatcherButtonProps): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleConfirm(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    const result = await deleteWatcher({ guildId, watcherId });
    if (!result.ok) {
      toast.error(result.error.message);
      setSubmitting(false);
      return;
    }
    toast.success('Watcher deleted');
    router.push(`/g/${guildId}/x-watcher`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop watching @{handle}?</DialogTitle>
          <DialogDescription>
            The bot stops mirroring this account and its post history (the audit log) is removed.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5 text-sm">
          <li className="flex items-start gap-2">
            <span
              className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-accent)]"
              aria-hidden="true"
            />
            <span>
              <span className="font-medium">Already-posted links stay in the channel.</span>{' '}
              <span className="text-[color:var(--color-fg-muted)]">
                Deleting only stops future mirroring.
              </span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span
              className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-fg-muted)]"
              aria-hidden="true"
            />
            <span>
              <span className="font-medium">Want a pause instead?</span>{' '}
              <span className="text-[color:var(--color-fg-muted)]">
                Use Pause to keep the position and resume later without backfilling.
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
            {submitting ? 'Deleting…' : 'Delete watcher'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
