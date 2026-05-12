'use client';

import { ReactionRolesOptionInputSchema } from '@hearth/reaction-roles-core/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

import {
  addReactionRolesOption,
  updateReactionRolesOption,
} from '@/actions/reaction-roles-options';
import { RolePicker } from '@/components/pickers/role-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const FormSchema = ReactionRolesOptionInputSchema;
type FormValues = z.infer<typeof FormSchema>;

interface RoleOption {
  readonly id: string;
  readonly name: string;
  readonly color: number;
}

interface ReactionRolesOptionFormProps {
  readonly guildId: string;
  readonly panelId: string;
  readonly roles: readonly RoleOption[];
  /** When set, the form is in "edit" mode against this option id. */
  readonly initial?: {
    readonly optionId: string;
    readonly label: string;
    readonly emoji: string;
    readonly roleId: string;
    readonly position: number;
  };
}

export function ReactionRolesOptionForm({
  guildId,
  panelId,
  roles,
  initial,
}: ReactionRolesOptionFormProps): React.JSX.Element {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    mode: 'onChange',
    defaultValues: {
      label: initial?.label ?? '',
      emoji: initial?.emoji ?? '',
      roleId: initial?.roleId ?? '',
      position: initial?.position ?? 0,
    },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      const result =
        initial !== undefined
          ? await updateReactionRolesOption({
              guildId,
              panelId,
              optionId: initial.optionId,
              input: values,
            })
          : await addReactionRolesOption({ guildId, panelId, input: values });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(initial !== undefined ? 'Option updated' : 'Option added');
      router.push(`/g/${guildId}/reaction-roles/${panelId}`);
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
      className="flex max-w-xl flex-col gap-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="option-label">Label</Label>
        <Input
          id="option-label"
          maxLength={80}
          aria-invalid={errors.label !== undefined}
          placeholder="e.g. English"
          {...register('label')}
        />
        {errors.label !== undefined ? (
          <p className="text-xs text-[color:var(--color-danger)]">{errors.label.message}</p>
        ) : (
          <p className="text-xs text-[color:var(--color-fg-muted)]">
            Shown in the embed body alongside the emoji. Keep it short.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="option-emoji">Emoji</Label>
        <Input
          id="option-emoji"
          maxLength={64}
          aria-invalid={errors.emoji !== undefined}
          placeholder="🇺🇸"
          {...register('emoji')}
        />
        {errors.emoji !== undefined ? (
          <p className="text-xs text-[color:var(--color-danger)]">{errors.emoji.message}</p>
        ) : (
          <p className="text-xs text-[color:var(--color-fg-muted)]">
            Unicode emoji like <code className="font-mono">🇺🇸</code> or a custom emoji reference{' '}
            <code className="font-mono">{'<:name:id>'}</code>. Custom emoji only work if the bot is
            in a guild that owns them.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="option-role">Role to grant</Label>
        <Controller
          name="roleId"
          control={control}
          render={({ field }) => (
            <RolePicker
              id="option-role"
              roles={roles}
              value={field.value}
              onChange={field.onChange}
              placeholder="Pick a role"
            />
          )}
        />
        {errors.roleId !== undefined ? (
          <p className="text-xs text-[color:var(--color-danger)]">{errors.roleId.message}</p>
        ) : (
          <p className="text-xs text-[color:var(--color-fg-muted)]">
            Granted while the user holds the reaction; revoked when they remove it. The bot&rsquo;s
            role must be above this role.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="option-position">Position</Label>
        <Input
          id="option-position"
          type="number"
          min={0}
          max={19}
          aria-invalid={errors.position !== undefined}
          {...register('position', { valueAsNumber: true })}
        />
        {errors.position !== undefined ? (
          <p className="text-xs text-[color:var(--color-danger)]">{errors.position.message}</p>
        ) : (
          <p className="text-xs text-[color:var(--color-fg-muted)]">
            Slot 0-19 — controls the reaction strip order (left-to-right). Must be unique per panel.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : initial !== undefined ? 'Save changes' : 'Add option'}
        </Button>
      </div>
    </form>
  );
}
