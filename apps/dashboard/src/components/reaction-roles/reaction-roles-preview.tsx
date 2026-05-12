'use client';

import { Eye } from 'lucide-react';

interface ReactionRolesPreviewProps {
  readonly title: string;
  readonly description: string;
  readonly footerText?: string | undefined;
  readonly options?: readonly {
    readonly id?: string;
    readonly label: string;
    readonly emoji: string;
    readonly roleId: string;
    readonly roleName?: string | undefined;
    readonly roleColor?: number | undefined;
    readonly position: number;
  }[];
}

/**
 * Live Discord-embed preview for a reaction-roles panel.
 *
 * Layout: left accent bar (BOT_BRAND_COLOR) + title + description body
 * that includes one rendered line per option, followed by a "Bot will
 * add:" reaction strip. Unlike verification, reaction-roles surface the
 * emoji→role binding inline so users see what each flag grants before
 * they react.
 */
export function ReactionRolesPreview({
  title,
  description,
  footerText,
  options = [],
}: ReactionRolesPreviewProps): React.JSX.Element {
  const accent = 'var(--color-accent)';
  const ordered = [...options].sort((a, b) => a.position - b.position);

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
            {/* Mirror Discord embed body: title + description only.
                PM asked (2026-05-12 follow-up) to drop the auto-generated
                option line list entirely — the pre-added reactions
                already surface the emojis, and operators tune the
                description copy to explain the rules. */}
            {footerText !== undefined && footerText !== '' ? (
              <p className="text-xs text-[color:var(--color-fg-muted)]">{footerText}</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Reaction strip — bot will pre-add these after the message lands. */}
      {ordered.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-[color:var(--color-fg-muted)]">
          <span>Bot will add:</span>
          <span className="inline-flex flex-wrap items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-2 py-1">
            {ordered.map((o, i) => (
              <span key={o.id ?? i} aria-hidden="true" className="text-sm">
                {o.emoji}
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}
