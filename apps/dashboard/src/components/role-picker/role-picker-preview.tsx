'use client';

import { ChevronDown, Eye } from 'lucide-react';

interface RolePickerPreviewProps {
  readonly title: string;
  readonly description: string;
  readonly placeholder: string;
  readonly footerText?: string | undefined;
  /** Discord StringSelectMenu `min_values`. When 0, Discord lets the user
   *  re-click their currently-selected option to deselect it (which fires
   *  `interaction.values=[]` → service revokes the role). single-select
   *  dropdowns don't render a separate "Clear selection" link — the
   *  re-click affordance is the only clear path. */
  readonly minValues?: number;
  readonly options?: readonly {
    readonly id?: string;
    readonly label: string;
    readonly description?: string | null;
    readonly emoji?: string | null;
    readonly roleId: string;
    readonly roleName?: string | undefined;
    readonly roleColor?: number | undefined;
    readonly position: number;
  }[];
}

/**
 * Live preview for a role-picker panel — embed plus a CSS mock of the
 * StringSelectMenu dropdown that Discord renders. The actual dropdown
 * is platform-rendered (we can't render it identically here), but the
 * preview shows the placeholder + option labels + emoji + role pills
 * so operators can iterate on copy without leaving the dashboard.
 */
export function RolePickerPreview({
  title,
  description,
  placeholder,
  footerText,
  minValues,
  options = [],
}: RolePickerPreviewProps): React.JSX.Element {
  const accent = 'var(--color-accent)';
  const ordered = [...options].sort((a, b) => a.position - b.position);
  const showClearAffordance = minValues === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[var(--radius-lg)] border bg-[color:var(--color-bg-subtle)] p-4">
        <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--color-fg-muted)]">
          <Eye className="h-3 w-3" aria-hidden="true" />
          User view
        </p>
        <div className="flex gap-3">
          <div
            className="w-1 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden="true"
          />
          <div className="flex-1 space-y-2">
            {title !== '' ? (
              <p className="text-base font-semibold">{title}</p>
            ) : (
              <p className="text-base font-semibold text-[color:var(--color-fg-muted)] italic">
                (no title)
              </p>
            )}
            <p className="whitespace-pre-wrap text-sm text-[color:var(--color-fg)]">
              {description !== '' ? (
                description
              ) : (
                <span className="italic text-[color:var(--color-fg-muted)]">(no description)</span>
              )}
            </p>
            {footerText !== undefined && footerText !== '' ? (
              <p className="text-xs text-[color:var(--color-fg-muted)]">{footerText}</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* CSS mock of Discord's StringSelectMenu — placeholder + list rows. */}
      <div className="rounded-[var(--radius)] border bg-[color:var(--color-bg)]">
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm text-[color:var(--color-fg-muted)]"
        >
          <span className="truncate">{placeholder !== '' ? placeholder : 'Pick a role…'}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
        {ordered.length > 0 ? (
          <ul className="divide-y border-t">
            {ordered.map((o, i) => (
              <li key={o.id ?? i} className="flex items-start gap-3 px-3 py-2 text-sm">
                <span className="shrink-0" aria-hidden="true">
                  {o.emoji ?? '•'}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{o.label}</span>
                  {o.description !== undefined && o.description !== null && o.description !== '' ? (
                    <span className="text-xs text-[color:var(--color-fg-muted)]">
                      {o.description}
                    </span>
                  ) : null}
                </div>
                <span
                  className="shrink-0 rounded-[var(--radius-sm)] bg-[color:var(--color-bg-subtle)] px-1.5 py-0.5 text-xs font-medium"
                  style={
                    o.roleColor !== undefined && o.roleColor !== 0
                      ? { color: `#${o.roleColor.toString(16).padStart(6, '0')}` }
                      : undefined
                  }
                >
                  @{o.roleName ?? `role:${o.roleId.slice(-4)}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t px-3 py-3 text-xs italic text-[color:var(--color-fg-muted)]">
            No options yet — add options to populate the dropdown.
          </p>
        )}
      </div>
      {showClearAffordance && ordered.length > 0 ? (
        <p className="px-1 text-xs text-[color:var(--color-fg-muted)]">
          Users can re-click their selected option in Discord to drop the role.
        </p>
      ) : null}
    </div>
  );
}
