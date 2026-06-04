'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AtSign } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { createWatcher, updateWatcher } from '@/actions/x-watcher';
import { ChannelPicker } from '@/components/pickers/channel-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ChannelOption {
  readonly id: string;
  readonly name: string;
  readonly type: 'text' | 'announcement';
}

interface XWatcherFormProps {
  readonly guildId: string;
  readonly channels: readonly ChannelOption[];
  readonly initial?: {
    readonly watcherId: string;
    readonly sourceHandle: string;
    readonly channelId: string;
    readonly includeQuotes: boolean;
    readonly includeReplies: boolean;
    readonly pollIntervalSec: number;
  };
}

// Poll-cadence presets (seconds). Operators pick from these rather than a
// free number — keeps choices sane and at/above the bot's base tick.
const INTERVAL_PRESETS: readonly { value: number; label: string }[] = [
  { value: 60, label: 'Every 1 minute' },
  { value: 120, label: 'Every 2 minutes' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 900, label: 'Every 15 minutes' },
  { value: 1800, label: 'Every 30 minutes' },
  { value: 3600, label: 'Every hour' },
];
const DEFAULT_INTERVAL = 300;

// Handle format is validated + normalised server-side (the action accepts
// "@x", a profile URL, or the bare handle). Client-side we only require it
// to be non-empty so the field can't be submitted blank.
const FormSchema = z.object({
  sourceHandle: z.string().min(1, 'X handle is required'),
  channelId: z.string().min(1, 'Channel is required'),
  includeQuotes: z.boolean(),
  includeReplies: z.boolean(),
  pollIntervalSec: z.coerce.number().int(),
});
type FormValues = z.infer<typeof FormSchema>;

export function XWatcherForm({ guildId, channels, initial }: XWatcherFormProps): React.JSX.Element {
  const router = useRouter();
  const isEdit = initial !== undefined;

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    mode: 'onChange',
    defaultValues: {
      sourceHandle: initial?.sourceHandle ?? '',
      channelId: initial?.channelId ?? '',
      includeQuotes: initial?.includeQuotes ?? true,
      includeReplies: initial?.includeReplies ?? false,
      pollIntervalSec: initial?.pollIntervalSec ?? DEFAULT_INTERVAL,
    },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      const result = isEdit
        ? await updateWatcher({
            guildId,
            watcherId: initial.watcherId,
            channelId: values.channelId,
            includeQuotes: values.includeQuotes,
            includeReplies: values.includeReplies,
            pollIntervalSec: values.pollIntervalSec,
          })
        : await createWatcher({
            guildId,
            sourceHandle: values.sourceHandle,
            channelId: values.channelId,
            includeQuotes: values.includeQuotes,
            includeReplies: values.includeReplies,
            pollIntervalSec: values.pollIntervalSec,
          });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(isEdit ? 'Watcher updated' : 'Watcher created');
      router.push(`/g/${guildId}/x-watcher/${result.value.watcherId}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unexpected error');
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="flex max-w-xl flex-col gap-5"
    >
      <div className="grid gap-2">
        <Label htmlFor="x-watcher-handle">X account</Label>
        {isEdit ? (
          // The source account is immutable — changing it would orphan the
          // dedupe cursor. To watch a different account, delete + recreate.
          <div className="flex items-center gap-2 rounded-[var(--radius)] border bg-[color:var(--color-bg-subtle)] px-3 py-2 text-sm">
            <AtSign className="h-4 w-4 text-[color:var(--color-fg-muted)]" aria-hidden="true" />
            <span className="font-medium">{initial.sourceHandle}</span>
            <span className="ml-auto text-xs text-[color:var(--color-fg-muted)]">
              Account can&rsquo;t be changed — delete &amp; recreate to watch another.
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[color:var(--color-fg-muted)]" aria-hidden="true">
                @
              </span>
              <Input
                id="x-watcher-handle"
                placeholder="account handle"
                autoComplete="off"
                aria-invalid={errors.sourceHandle !== undefined}
                {...register('sourceHandle')}
              />
            </div>
            {errors.sourceHandle !== undefined ? (
              <p className="text-xs text-[color:var(--color-danger)]">
                {errors.sourceHandle.message}
              </p>
            ) : (
              <p className="text-xs text-[color:var(--color-fg-muted)]">
                Paste the handle, @handle, or full profile URL — we&rsquo;ll tidy it up.
              </p>
            )}
          </>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="x-watcher-channel">Post into channel</Label>
        <Controller
          name="channelId"
          control={control}
          render={({ field }) => (
            <ChannelPicker
              id="x-watcher-channel"
              channels={channels}
              value={field.value}
              onChange={field.onChange}
              placeholder="Pick a channel"
            />
          )}
        />
        {errors.channelId !== undefined ? (
          <p className="text-xs text-[color:var(--color-danger)]">{errors.channelId.message}</p>
        ) : (
          <p className="text-xs text-[color:var(--color-fg-muted)]">
            New posts are mirrored here as a bare link.
          </p>
        )}
      </div>

      <fieldset className="grid gap-3 rounded-[var(--radius)] border bg-[color:var(--color-bg-subtle)] p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
          What to mirror
        </legend>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 cursor-pointer accent-[color:var(--color-accent)]"
            {...register('includeQuotes')}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Include quote posts</span>
            <span className="text-xs text-[color:var(--color-fg-muted)]">
              Quote tweets are mirrored. Turn off to post original tweets only.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 cursor-pointer accent-[color:var(--color-accent)]"
            {...register('includeReplies')}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Include replies</span>
            <span className="text-xs text-[color:var(--color-fg-muted)]">
              Off by default — replies can be chatty. Retweets are never mirrored.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="x-watcher-interval">Check frequency</Label>
        <select
          id="x-watcher-interval"
          className="h-9 rounded-[var(--radius)] border bg-[color:var(--color-bg)] px-3 text-sm"
          {...register('pollIntervalSec')}
        >
          {INTERVAL_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-[color:var(--color-fg-muted)]">
          How often the bot checks this account for new posts. Lower = faster, but more X API reads
          (cost). 5 minutes is a good default.
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create watcher'}
        </Button>
      </div>
    </form>
  );
}
