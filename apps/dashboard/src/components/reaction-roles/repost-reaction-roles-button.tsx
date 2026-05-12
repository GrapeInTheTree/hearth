'use client';

import { ArrowDownToLine, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { repostReactionRolesPanel } from '@/actions/reaction-roles';
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

interface RepostReactionRolesButtonProps {
  readonly guildId: string;
  readonly panelId: string;
}

/**
 * Repost is the destructive sibling of "save option" — it drops the
 * existing Discord message entirely and posts a fresh one at the bottom
 * of the channel. Operators rarely need this for option edits anymore
 * (those auto-sync in place since the polish round), so the modal
 * frames it as the "freshen the panel" path and surfaces both the
 * persistent effect (roles stay) and the visible reset (reactions
 * cleared) up front.
 */
export function RepostReactionRolesButton({
  guildId,
  panelId,
}: RepostReactionRolesButtonProps): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  async function handleConfirm(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    const result = await repostReactionRolesPanel({ guildId, panelId });
    setSubmitting(false);
    setOpen(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Repost to channel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Repost the reaction-roles panel?</DialogTitle>
          <DialogDescription>
            The existing Discord message will be deleted and a new one will appear at the bottom of
            the channel.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5 text-sm">
          <li className="flex items-start gap-2">
            <span
              className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-accent)]"
              aria-hidden="true"
            />
            <span>
              <span className="font-medium">Users keep their roles.</span>{' '}
              <span className="text-[color:var(--color-fg-muted)]">
                Role grants are member-level, not message-level.
              </span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span
              className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-fg-muted)]"
              aria-hidden="true"
            />
            <span>
              <span className="font-medium">Visible reactions reset.</span>{' '}
              <span className="text-[color:var(--color-fg-muted)]">
                Users have to re-react to toggle off — one extra click each time they want to remove
                their role.
              </span>
            </span>
          </li>
        </ul>

        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] p-3 text-xs text-[color:var(--color-fg-muted)]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            For adding or editing options you usually don&rsquo;t need this — edits sync to the
            existing message automatically. Use Repost only when you want the panel to surface at
            the bottom of the channel again.
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={() => {
              void handleConfirm();
            }}
            disabled={submitting}
          >
            {submitting ? 'Reposting…' : 'Repost panel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
