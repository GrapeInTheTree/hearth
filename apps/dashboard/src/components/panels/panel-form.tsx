'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { createPanel, updatePanel } from '@/actions/panels';
import { PanelPreview } from '@/components/panels/panel-preview';
import { ChannelPicker } from '@/components/pickers/channel-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface ChannelOption {
  readonly id: string;
  readonly name: string;
  readonly type: 'text' | 'announcement';
}

interface PanelFormProps {
  readonly guildId: string;
  readonly channels: readonly ChannelOption[];
  /**
   * When provided, the form is in "edit" mode: channelId is locked, only
   * embed title/description are mutable. Edit goes through updatePanel.
   */
  readonly initial?: {
    readonly panelId: string;
    readonly channelId: string;
    readonly embedTitle: string;
    readonly embedDescription: string;
  };
}

const SESSION_KEY_PREFIX = 'panel-form:';

/**
 * Panel create/edit form. State lives in React (uncontrolled inputs would
 * complicate the live preview), and is also persisted to sessionStorage
 * keyed by panelId or 'new' so accidental navigation away doesn't lose
 * the operator's work.
 */
export function PanelForm({ guildId, channels, initial }: PanelFormProps): React.JSX.Element {
  const router = useRouter();
  const sessionKey = `${SESSION_KEY_PREFIX}${initial?.panelId ?? 'new'}`;
  const [channelId, setChannelId] = React.useState(initial?.channelId ?? '');
  const [title, setTitle] = React.useState(initial?.embedTitle ?? 'Contact Team');
  const [description, setDescription] = React.useState(
    initial?.embedDescription ?? 'Click a button below to open a ticket.',
  );
  const [submitting, setSubmitting] = React.useState(false);

  // Hydrate from sessionStorage on first mount (client only).
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(sessionKey);
    if (stored === null) return;
    try {
      const parsed = JSON.parse(stored) as {
        channelId?: string;
        title?: string;
        description?: string;
      };
      if (typeof parsed.channelId === 'string') setChannelId(parsed.channelId);
      if (typeof parsed.title === 'string') setTitle(parsed.title);
      if (typeof parsed.description === 'string') setDescription(parsed.description);
    } catch {
      // Ignore — persisted state corrupted; start clean.
    }
    // sessionKey is stable per form instance — only run on mount.
  }, [sessionKey]);

  // Persist on every change.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(sessionKey, JSON.stringify({ channelId, title, description }));
  }, [sessionKey, channelId, title, description]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const result =
        initial !== undefined
          ? await updatePanel({
              guildId,
              panelId: initial.panelId,
              embedTitle: title,
              embedDescription: description,
            })
          : await createPanel({
              guildId,
              input: {
                guildId,
                channelId,
                embedTitle: title,
                embedDescription: description,
              },
            });
      if (!result.ok) {
        toast.error(result.error.message);
        setSubmitting(false);
        return;
      }
      // Clear persisted state on successful submit.
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(sessionKey);
      }
      if (result.value.discordSyncFailed) {
        toast.warning('Saved. Discord re-render queued — retry from the panel detail page.');
      } else {
        toast.success(initial !== undefined ? 'Panel updated' : 'Panel created');
      }
      router.push(`/g/${guildId}/panels/${result.value.value.panelId}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unexpected error');
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]"
    >
      <div className="flex flex-col gap-4">
        {initial === undefined ? (
          <div className="grid gap-2">
            <Label htmlFor="panel-channel">Channel</Label>
            <ChannelPicker
              id="panel-channel"
              channels={channels}
              value={channelId}
              onChange={setChannelId}
              placeholder="Pick a channel"
            />
            <p className="text-xs text-[color:var(--color-fg-muted)]">
              Where the panel message will be posted. Operators usually pick a public-facing channel
              like <span className="font-mono">#contact-team</span>.
            </p>
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="panel-title">Embed title</Label>
          <Input
            id="panel-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            maxLength={256}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="panel-description">Embed description</Label>
          <Textarea
            id="panel-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            maxLength={4000}
          />
          <p className="text-xs text-[color:var(--color-fg-muted)]">
            Discord markdown supported (bold, italics, lists). Use real line breaks for paragraph
            spacing.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="submit"
            disabled={submitting || (initial === undefined && channelId === '')}
          >
            {submitting ? 'Saving…' : initial !== undefined ? 'Save changes' : 'Create panel'}
          </Button>
        </div>
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <PanelPreview title={title} description={description} />
      </div>
    </form>
  );
}
