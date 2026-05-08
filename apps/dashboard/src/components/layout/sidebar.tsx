'use client';

import { Inbox, LayoutDashboard, Settings, ShieldCheck, Tag } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { t } from '@/i18n';
import { cn } from '@/lib/cn';

interface NavItem {
  readonly href: string;
  readonly label: () => string;
  readonly icon: typeof LayoutDashboard;
  /** When true, only `activePath === href` highlights it (use for "/" overview). */
  readonly exact?: boolean;
}

interface NavSection {
  /** Optional uppercase section header. Overview-style top items use undefined. */
  readonly header?: () => string;
  readonly items: readonly NavItem[];
}

// Sidebar IA — sections + items. Adding a new domain (self-roles, welcome,
// moderation, …) means dropping a NavItem into the right section. The
// indentation + section header carry the "this is a feature group" signal,
// so individual labels stay short ("Tickets" rather than "Ticket
// Conversations"). Sections themselves are not collapsible — there are
// only 5–10 items expected long-term, well within scrollable single-pane.
const NAV_SECTIONS: readonly NavSection[] = [
  {
    items: [{ href: '', label: () => t.nav.overview, icon: LayoutDashboard, exact: true }],
  },
  {
    header: () => t.nav.sectionWorkspace,
    items: [
      { href: '/panels', label: () => t.nav.panels, icon: Tag },
      { href: '/tickets', label: () => t.nav.tickets, icon: Inbox },
      { href: '/verification', label: () => t.nav.verification, icon: ShieldCheck },
    ],
  },
  {
    header: () => t.nav.sectionAccount,
    items: [{ href: '/settings', label: () => t.nav.settings, icon: Settings }],
  },
];

interface SidebarProps {
  readonly guildId: string;
  readonly brandName: string;
  readonly brandIconUrl: string | undefined;
}

// Client component so the active-item highlight updates on every
// client-side navigation. Server-side computation via the
// (authenticated)/g/[guildId]/layout.tsx + x-pathname header doesn't work
// here because Next.js App Router shares the same layout instance across
// child page navigations — the layout (and thus a server-computed
// activePath) only re-runs on a hard refresh.
//
// Brand props are passed in (rather than imported from @/config/branding)
// so this client component doesn't drag the env-validating module into
// the client bundle — that module reaches @hearth/tickets-core's barrel
// which transitively imports pg/node:dns/net/tls.
export function Sidebar({ guildId, brandName, brandIconUrl }: SidebarProps): React.JSX.Element {
  const base = `/g/${guildId}`;
  const pathname = usePathname();
  const activePath = pathname.startsWith(base) ? pathname.slice(base.length) : '';

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r bg-[color:var(--color-bg)]">
      <div className="flex h-14 items-center border-b px-6">
        <Link
          href="/select-guild"
          className="flex items-center gap-2 text-[color:var(--color-fg)] transition-opacity hover:opacity-80"
        >
          {brandIconUrl !== undefined ? (
            <img
              src={brandIconUrl}
              alt={brandName}
              width={24}
              height={24}
              className="h-6 w-6 rounded-[var(--radius-sm)]"
            />
          ) : (
            <span
              className="h-6 w-6 rounded-[var(--radius-sm)]"
              style={{ backgroundColor: 'var(--color-accent)' }}
              aria-hidden="true"
            />
          )}
          <span className="font-semibold tracking-tight">{brandName}</span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-6" aria-label="Primary">
        <ul className="flex flex-col gap-6">
          {NAV_SECTIONS.map((section, sectionIdx) => (
            <li key={sectionIdx}>
              {section.header !== undefined ? (
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-fg-muted)]">
                  {section.header()}
                </p>
              ) : null}
              <ul className="flex flex-col gap-0.5">
                {section.items.map(({ href, label, icon: Icon, exact = false }) => {
                  const isActive = exact ? activePath === '' : activePath.startsWith(href);
                  return (
                    <li key={href === '' ? 'overview' : href}>
                      <Link
                        href={`${base}${href}`}
                        className={cn(
                          'flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)]',
                          isActive
                            ? 'bg-[color:var(--color-bg-subtle)] text-[color:var(--color-fg)]'
                            : 'text-[color:var(--color-fg-muted)] hover:bg-[color:var(--color-bg-subtle)] hover:text-[color:var(--color-fg)]',
                        )}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{label()}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
