'use client';

import { Check, Eye, EyeOff } from 'lucide-react';

interface VerificationPreviewProps {
  readonly title: string;
  readonly description: string;
  readonly footerText?: string | undefined;
  readonly options?: readonly {
    readonly id?: string;
    readonly label: string;
    readonly emoji: string | undefined;
    readonly style: 'primary' | 'secondary' | 'success' | 'danger';
    readonly position: number;
  }[];
  /** id of the option marked correct, if any. Renders an admin-only marker
   *  below the embed (not inside the button row, so all buttons share a
   *  single baseline). */
  readonly correctOptionId?: string | null | undefined;
}

const STYLE_TO_CLASS: Record<string, string> = {
  primary: 'bg-[#5865F2] text-white',
  secondary: 'bg-[#4F545C] text-white',
  success: 'bg-[#3BA55D] text-white',
  danger: 'bg-[#ED4245] text-white',
};

/**
 * Live Discord-embed preview for a verification panel.
 *
 * Layout: left accent bar (BOT_BRAND_COLOR) + title + description + button
 * row, mirroring how Discord renders an embed-with-buttons message. All
 * buttons share a single baseline regardless of which is correct — the
 * correct marker is an admin-only annotation rendered *outside* the
 * embed, so the preview matches what the end user actually sees on
 * Discord (no telltale highlight on the right answer).
 */
export function VerificationPreview({
  title,
  description,
  footerText,
  options = [],
  correctOptionId,
}: VerificationPreviewProps): React.JSX.Element {
  const accent = 'var(--color-accent)';
  const ordered = [...options].sort((a, b) => a.position - b.position);
  const correct =
    correctOptionId === null || correctOptionId === undefined
      ? undefined
      : ordered.find((o) => o.id === correctOptionId);

  return (
    <div className="flex flex-col gap-3">
      {/* Embed body — what Discord users actually see. */}
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
            {ordered.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {ordered.map((b, i) => (
                  <span
                    key={b.id ?? i}
                    className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium ${STYLE_TO_CLASS[b.style] ?? STYLE_TO_CLASS.primary}`}
                  >
                    {b.emoji !== undefined ? <span aria-hidden="true">{b.emoji}</span> : null}
                    <span>{b.label}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="pt-2 text-xs italic text-[color:var(--color-fg-muted)]">
                No options yet — buttons appear here once you add options.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Admin-only annotation. Outside the embed so the preview matches
          exactly what users see (no leaked correct-answer cue). */}
      {ordered.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-[color:var(--color-fg-muted)]">
          <EyeOff className="h-3 w-3" aria-hidden="true" />
          <span>Admin only:</span>
          {correct !== undefined ? (
            <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-2 py-0.5 font-medium text-[color:var(--color-fg)]">
              <Check className="h-3 w-3 text-[color:var(--color-accent)]" aria-hidden="true" />
              correct ={' '}
              {correct.emoji !== undefined ? (
                <span aria-hidden="true">{correct.emoji}</span>
              ) : null}{' '}
              {correct.label}
            </span>
          ) : (
            <span className="rounded-[var(--radius-sm)] bg-[color:var(--color-bg-subtle)] px-2 py-0.5">
              no correct option set
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
