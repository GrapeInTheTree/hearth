'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { addTicketType, editTicketType } from '@/actions/ticket-types';
import { CategoryPicker } from '@/components/pickers/category-picker';
import { RoleMultiPicker } from '@/components/pickers/role-multi-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger';
const BUTTON_STYLES: readonly { value: ButtonStyle; label: string }[] = [
  { value: 'primary', label: 'Primary (blurple)' },
  { value: 'secondary', label: 'Secondary (grey)' },
  { value: 'success', label: 'Success (green)' },
  { value: 'danger', label: 'Danger (red)' },
];

interface Category {
  readonly id: string;
  readonly name: string;
}
interface Role {
  readonly id: string;
  readonly name: string;
  readonly color: number;
}

interface TicketTypeFormProps {
  readonly guildId: string;
  readonly panelId: string;
  readonly categories: readonly Category[];
  readonly roles: readonly Role[];
  /**
   * When provided, the form is in "edit" mode for an existing type.
   * Name is locked (renaming requires remove + add to keep slash-command
   * `name:` references stable).
   */
  readonly initial?: {
    readonly typeId: string;
    readonly name: string;
    readonly label: string;
    readonly emoji: string;
    readonly buttonStyle: ButtonStyle;
    readonly activeCategoryId: string;
    readonly supportRoleIds: readonly string[];
    readonly pingRoleIds: readonly string[];
    readonly perUserLimit: number | null;
    readonly welcomeMessage: string | null;
  };
}

const SESSION_KEY_PREFIX = 'ticket-type-form:';

export function TicketTypeForm({
  guildId,
  panelId,
  categories,
  roles,
  initial,
}: TicketTypeFormProps): React.JSX.Element {
  const router = useRouter();
  const sessionKey = `${SESSION_KEY_PREFIX}${initial?.typeId ?? `new:${panelId}`}`;
  const [name, setName] = React.useState(initial?.name ?? '');
  const [label, setLabel] = React.useState(initial?.label ?? '');
  const [emoji, setEmoji] = React.useState(initial?.emoji ?? '');
  const [buttonStyle, setButtonStyle] = React.useState<ButtonStyle>(
    initial?.buttonStyle ?? 'success',
  );
  const [activeCategoryId, setActiveCategoryId] = React.useState(initial?.activeCategoryId ?? '');
  const [supportRoleIds, setSupportRoleIds] = React.useState<string[]>([
    ...(initial?.supportRoleIds ?? []),
  ]);
  const [pingRoleIds, setPingRoleIds] = React.useState<string[]>([...(initial?.pingRoleIds ?? [])]);
  const [perUserLimit, setPerUserLimit] = React.useState<string>(
    initial?.perUserLimit !== null && initial?.perUserLimit !== undefined
      ? String(initial.perUserLimit)
      : '1',
  );
  const [welcomeMessage, setWelcomeMessage] = React.useState(initial?.welcomeMessage ?? '');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(sessionKey);
    if (stored === null) return;
    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      if (typeof parsed.name === 'string') setName(parsed.name);
      if (typeof parsed.label === 'string') setLabel(parsed.label);
      if (typeof parsed.emoji === 'string') setEmoji(parsed.emoji);
      if (typeof parsed.buttonStyle === 'string') {
        setButtonStyle(parsed.buttonStyle as ButtonStyle);
      }
      if (typeof parsed.activeCategoryId === 'string') setActiveCategoryId(parsed.activeCategoryId);
      if (Array.isArray(parsed.supportRoleIds)) {
        setSupportRoleIds(parsed.supportRoleIds.filter((s): s is string => typeof s === 'string'));
      }
      if (Array.isArray(parsed.pingRoleIds)) {
        setPingRoleIds(parsed.pingRoleIds.filter((s): s is string => typeof s === 'string'));
      }
      if (typeof parsed.perUserLimit === 'string') setPerUserLimit(parsed.perUserLimit);
      if (typeof parsed.welcomeMessage === 'string') setWelcomeMessage(parsed.welcomeMessage);
    } catch {
      // Ignore.
    }
  }, [sessionKey]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(
      sessionKey,
      JSON.stringify({
        name,
        label,
        emoji,
        buttonStyle,
        activeCategoryId,
        supportRoleIds,
        pingRoleIds,
        perUserLimit,
        welcomeMessage,
      }),
    );
  }, [
    sessionKey,
    name,
    label,
    emoji,
    buttonStyle,
    activeCategoryId,
    supportRoleIds,
    pingRoleIds,
    perUserLimit,
    welcomeMessage,
  ]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const limit = perUserLimit.trim() === '' ? null : Number.parseInt(perUserLimit, 10);
      const result =
        initial !== undefined
          ? await editTicketType({
              guildId,
              typeId: initial.typeId,
              fields: {
                label,
                emoji,
                buttonStyle,
                activeCategoryId,
                supportRoleIds,
                pingRoleIds,
                perUserLimit: limit !== null && Number.isFinite(limit) ? limit : null,
                welcomeMessage: welcomeMessage === '' ? null : welcomeMessage,
              },
            })
          : await addTicketType({
              guildId,
              input: {
                panelId,
                name,
                label,
                emoji,
                buttonStyle,
                activeCategoryId,
                supportRoleIds,
                pingRoleIds,
                perUserLimit: limit !== null && Number.isFinite(limit) ? limit : null,
                welcomeMessage: welcomeMessage === '' ? undefined : welcomeMessage,
              },
            });
      if (!result.ok) {
        toast.error(result.error.message);
        setSubmitting(false);
        return;
      }
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(sessionKey);
      }
      if (result.value.discordSyncFailed) {
        toast.warning('Saved. Discord re-render queued — retry from the panel detail page.');
      } else {
        toast.success(initial !== undefined ? 'Type updated' : 'Type added');
      }
      router.push(`/g/${guildId}/panels/${panelId}`);
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
      className="flex max-w-2xl flex-col gap-4"
    >
      {initial === undefined ? (
        <div className="grid gap-2">
          <Label htmlFor="type-name">Name (stable identifier)</Label>
          <Input
            id="type-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="e.g. question"
            pattern="[a-z0-9-]+"
            maxLength={32}
            required
          />
          <p className="text-xs text-[color:var(--color-fg-muted)]">
            Lowercase letters, digits, and hyphens. Used internally — to rename, remove and re-add.
          </p>
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="type-label">Button label</Label>
        <Input
          id="type-label"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
          placeholder="e.g. Question"
          maxLength={80}
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="type-emoji">Button emoji</Label>
        <Input
          id="type-emoji"
          value={emoji}
          onChange={(e) => {
            setEmoji(e.target.value);
          }}
          placeholder="e.g. ❓ (leave blank for none)"
          maxLength={64}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="type-style">Button style</Label>
        <select
          id="type-style"
          value={buttonStyle}
          onChange={(e) => {
            setButtonStyle(e.target.value as ButtonStyle);
          }}
          className="flex h-9 w-full appearance-none rounded-[var(--radius)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        >
          {BUTTON_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="type-category">Active category</Label>
        <CategoryPicker
          id="type-category"
          categories={categories}
          value={activeCategoryId}
          onChange={setActiveCategoryId}
        />
        <p className="text-xs text-[color:var(--color-fg-muted)]">
          New tickets of this type are created as channels under this category.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="type-support-roles">Support roles</Label>
        <RoleMultiPicker
          id="type-support-roles"
          roles={roles}
          value={supportRoleIds}
          onChange={setSupportRoleIds}
          placeholder="Pick one or more support roles"
        />
        <p className="text-xs text-[color:var(--color-fg-muted)]">
          Roles allowed to claim, close, and reopen tickets of this type.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="type-ping-roles">Ping roles (optional)</Label>
        <RoleMultiPicker
          id="type-ping-roles"
          roles={roles}
          value={pingRoleIds}
          onChange={setPingRoleIds}
          placeholder="Pick roles to mention on ticket creation"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="type-limit">Per-user limit</Label>
        <Input
          id="type-limit"
          type="number"
          min={1}
          max={20}
          value={perUserLimit}
          onChange={(e) => {
            setPerUserLimit(e.target.value);
          }}
        />
        <p className="text-xs text-[color:var(--color-fg-muted)]">
          Max simultaneous open tickets per user (default 1).
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="type-welcome">Welcome message (optional)</Label>
        <Textarea
          id="type-welcome"
          value={welcomeMessage}
          onChange={(e) => {
            setWelcomeMessage(e.target.value);
          }}
          maxLength={4000}
          placeholder="Leave blank to use the default welcome copy"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="submit"
          disabled={
            submitting ||
            label === '' ||
            (initial === undefined && name === '') ||
            activeCategoryId === '' ||
            supportRoleIds.length === 0
          }
        >
          {submitting ? 'Saving…' : initial !== undefined ? 'Save changes' : 'Add type'}
        </Button>
      </div>
    </form>
  );
}
