'use client';

import { ReactionRolesPanelInputSchema } from '@hearth/reaction-roles-core/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { ReactionRolesPreview } from './reaction-roles-preview';

import { createReactionRolesPanel, updateReactionRolesPanel } from '@/actions/reaction-roles';
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

interface ReactionRolesPanelFormProps {
  readonly guildId: string;
  readonly channels: readonly ChannelOption[];
  /**
   * When provided, the form is in "edit" mode. The channel can switch
   * without breaking anything — option role grants outlive the message
   * they were originally posted from.
   */
  readonly initial?: {
    readonly panelId: string;
    readonly channelId: string;
    readonly embedTitle: string;
    readonly embedDescription: string;
  };
}

const SESSION_KEY_PREFIX = 'reaction-roles-panel-form:';

const FormSchema = ReactionRolesPanelInputSchema.extend({
  embedTitle: z.string().min(1, 'Title is required').max(256),
  embedDescription: z.string().min(1, 'Description is required').max(4000),
});
type FormValues = z.infer<typeof FormSchema>;

export function ReactionRolesPanelForm({
  guildId,
  channels,
  initial,
}: ReactionRolesPanelFormProps): React.JSX.Element {
  const router = useRouter();
  const sessionKey = `${SESSION_KEY_PREFIX}${initial?.panelId ?? 'new'}`;

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    mode: 'onChange',
    defaultValues: {
      guildId,
      channelId: initial?.channelId ?? '',
      embedTitle: initial?.embedTitle ?? 'Select your roles',
      embedDescription:
        initial?.embedDescription ??
        'React to this message with the emoji that matches a role you want. Remove your reaction to give the role back.',
    },
  });

  const title = watch('embedTitle');
  const description = watch('embedDescription');
  const channelId = watch('channelId');

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
      if (typeof parsed.channelId === 'string') {
        setValue('channelId', parsed.channelId, { shouldValidate: false });
      }
      if (typeof parsed.title === 'string') {
        setValue('embedTitle', parsed.title, { shouldValidate: false });
      }
      if (typeof parsed.description === 'string') {
        setValue('embedDescription', parsed.description, { shouldValidate: false });
      }
    } catch {
      // Persisted state corrupted — start clean.
    }
  }, [sessionKey, setValue]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(sessionKey, JSON.stringify({ channelId, title, description }));
  }, [sessionKey, channelId, title, description]);

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      const result =
        initial !== undefined
          ? await updateReactionRolesPanel({
              guildId,
              panelId: initial.panelId,
              channelId: values.channelId,
              embedTitle: values.embedTitle,
              embedDescription: values.embedDescription,
            })
          : await createReactionRolesPanel({
              guildId,
              input: {
                guildId,
                channelId: values.channelId,
                embedTitle: values.embedTitle,
                embedDescription: values.embedDescription,
              },
            });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(sessionKey);
      }
      if (result.value.discordSyncFailed) {
        toast.warning(
          result.value.discordSyncMessage ??
            'Saved. Discord re-render queued — retry from the panel detail page.',
        );
      } else {
        toast.success(initial !== undefined ? 'Panel updated' : 'Panel created');
      }
      router.push(`/g/${guildId}/reaction-roles/${result.value.value.panelId}`);
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
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]"
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="reaction-roles-channel">Channel</Label>
          <Controller
            name="channelId"
            control={control}
            render={({ field }) => (
              <ChannelPicker
                id="reaction-roles-channel"
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
              The reaction-roles message will be posted here. Languages typically live in a #info or
              #welcome channel.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="reaction-roles-title">Embed title</Label>
          <Input
            id="reaction-roles-title"
            maxLength={256}
            aria-invalid={errors.embedTitle !== undefined}
            {...register('embedTitle')}
          />
          {errors.embedTitle !== undefined ? (
            <p className="text-xs text-[color:var(--color-danger)]">{errors.embedTitle.message}</p>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="reaction-roles-description">Embed description</Label>
          <Textarea
            id="reaction-roles-description"
            maxLength={4000}
            aria-invalid={errors.embedDescription !== undefined}
            {...register('embedDescription')}
          />
          {errors.embedDescription !== undefined ? (
            <p className="text-xs text-[color:var(--color-danger)]">
              {errors.embedDescription.message}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : initial !== undefined ? 'Save changes' : 'Create panel'}
          </Button>
        </div>
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <ReactionRolesPreview title={title} description={description} />
      </div>
    </form>
  );
}
