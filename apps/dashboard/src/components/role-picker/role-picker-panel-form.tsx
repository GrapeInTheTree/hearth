'use client';

import { RolePickerPanelInputSchema } from '@hearth/role-picker-core/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { RolePickerPreview } from './role-picker-preview';

import { createRolePickerPanel, updateRolePickerPanel } from '@/actions/role-picker';
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

interface RolePickerPanelFormProps {
  readonly guildId: string;
  readonly channels: readonly ChannelOption[];
  readonly initial?: {
    readonly panelId: string;
    readonly channelId: string;
    readonly embedTitle: string;
    readonly embedDescription: string;
    readonly placeholder: string;
    readonly minValues: number;
  };
}

const SESSION_KEY_PREFIX = 'role-picker-panel-form:';

const FormSchema = RolePickerPanelInputSchema.extend({
  embedTitle: z.string().min(1, 'Title is required').max(256),
  embedDescription: z.string().min(1, 'Description is required').max(4000),
  placeholder: z.string().min(1, 'Placeholder is required').max(150),
  // Boolean façade over minValues. When ON: minValues=0, Discord renders
  // a native "Clear selection" link in the dropdown. When OFF: minValues=1,
  // strict pick-required. v1 keeps maxValues locked to 1 (single-select).
  allowClear: z.boolean(),
});
type FormValues = z.infer<typeof FormSchema>;

export function RolePickerPanelForm({
  guildId,
  channels,
  initial,
}: RolePickerPanelFormProps): React.JSX.Element {
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
      embedTitle: initial?.embedTitle ?? 'Pick your role',
      embedDescription:
        initial?.embedDescription ?? 'Open the dropdown below and pick the option you want.',
      placeholder: initial?.placeholder ?? 'Pick a role…',
      allowClear: initial !== undefined ? initial.minValues === 0 : true,
    },
  });

  const title = watch('embedTitle');
  const description = watch('embedDescription');
  const placeholder = watch('placeholder');
  const channelId = watch('channelId');
  const allowClear = watch('allowClear');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(sessionKey);
    if (stored === null) return;
    try {
      const parsed = JSON.parse(stored) as {
        channelId?: string;
        title?: string;
        description?: string;
        placeholder?: string;
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
      if (typeof parsed.placeholder === 'string') {
        setValue('placeholder', parsed.placeholder, { shouldValidate: false });
      }
    } catch {
      // corrupted — ignore
    }
  }, [sessionKey, setValue]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(
      sessionKey,
      JSON.stringify({ channelId, title, description, placeholder }),
    );
  }, [sessionKey, channelId, title, description, placeholder]);

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      const minValues = values.allowClear ? 0 : 1;
      const result =
        initial !== undefined
          ? await updateRolePickerPanel({
              guildId,
              panelId: initial.panelId,
              channelId: values.channelId,
              embedTitle: values.embedTitle,
              embedDescription: values.embedDescription,
              placeholder: values.placeholder,
              minValues,
            })
          : await createRolePickerPanel({
              guildId,
              input: {
                guildId,
                channelId: values.channelId,
                embedTitle: values.embedTitle,
                embedDescription: values.embedDescription,
                placeholder: values.placeholder,
                minValues,
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
      router.push(`/g/${guildId}/role-picker/${result.value.value.panelId}`);
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
          <Label htmlFor="role-picker-channel">Channel</Label>
          <Controller
            name="channelId"
            control={control}
            render={({ field }) => (
              <ChannelPicker
                id="role-picker-channel"
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
              The role-picker message will be posted here.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="role-picker-title">Embed title</Label>
          <Input
            id="role-picker-title"
            maxLength={256}
            aria-invalid={errors.embedTitle !== undefined}
            {...register('embedTitle')}
          />
          {errors.embedTitle !== undefined ? (
            <p className="text-xs text-[color:var(--color-danger)]">{errors.embedTitle.message}</p>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="role-picker-description">Embed description</Label>
          <Textarea
            id="role-picker-description"
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

        <div className="grid gap-2">
          <Label htmlFor="role-picker-placeholder">Dropdown placeholder</Label>
          <Input
            id="role-picker-placeholder"
            maxLength={150}
            aria-invalid={errors.placeholder !== undefined}
            {...register('placeholder')}
          />
          {errors.placeholder !== undefined ? (
            <p className="text-xs text-[color:var(--color-danger)]">{errors.placeholder.message}</p>
          ) : (
            <p className="text-xs text-[color:var(--color-fg-muted)]">
              Chrome text shown inside the dropdown when nothing is selected.
            </p>
          )}
        </div>

        <div className="grid gap-2 rounded-[var(--radius)] border bg-[color:var(--color-bg-subtle)] p-3">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 cursor-pointer accent-[color:var(--color-accent)]"
              {...register('allowClear')}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Allow users to clear their selection</span>
              <span className="text-xs text-[color:var(--color-fg-muted)]">
                Discord shows a native &ldquo;Clear selection&rdquo; link at the bottom of the
                dropdown. Users can drop their role without an admin.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : initial !== undefined ? 'Save changes' : 'Create panel'}
          </Button>
        </div>
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <RolePickerPreview
          title={title}
          description={description}
          placeholder={placeholder}
          minValues={allowClear ? 0 : 1}
        />
      </div>
    </form>
  );
}
