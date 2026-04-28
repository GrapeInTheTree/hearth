'use client';

interface PanelPreviewProps {
  readonly title: string;
  readonly description: string;
  readonly footerText?: string | undefined;
  readonly typeButtons?: readonly {
    label: string;
    emoji: string | undefined;
    style: 'primary' | 'secondary' | 'success' | 'danger';
  }[];
}

const STYLE_TO_CLASS: Record<string, string> = {
  primary: 'bg-[#5865F2] text-white',
  secondary: 'bg-[#4F545C] text-white',
  success: 'bg-[#3BA55D] text-white',
  danger: 'bg-[#ED4245] text-white',
};

/**
 * Live Discord-embed preview. Reproduces Discord's rendering of an
 * embed (left color bar, title, description, footer) plus the panel's
 * button row. Pure CSS — no Discord assets — so it stays bundle-small
 * and unaffected by Discord client redesigns.
 *
 * Updates on every keystroke from the form. The accent color comes from
 * BOT_BRAND_COLOR via the same CSS var the rest of the dashboard uses,
 * so the preview always matches the operator's deployment.
 */
export function PanelPreview({
  title,
  description,
  footerText,
  typeButtons = [],
}: PanelPreviewProps): React.JSX.Element {
  // Read the accent color from the CSS var the root layout injected.
  // Avoids importing branding (server-only env) into a client component.
  const accent = 'var(--color-accent)';
  return (
    <div className="rounded-[var(--radius-lg)] border bg-[color:var(--color-bg-subtle)] p-4">
      <p className="mb-2 text-xs font-medium text-[color:var(--color-fg-muted)]">Preview</p>
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
          {typeButtons.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {typeButtons.map((b, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium ${STYLE_TO_CLASS[b.style] ?? STYLE_TO_CLASS.success}`}
                >
                  {b.emoji !== undefined ? <span>{b.emoji}</span> : null}
                  <span>{b.label}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-[color:var(--color-fg-muted)] pt-2">
              No ticket types yet — buttons appear here once you add types.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
