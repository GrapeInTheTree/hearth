'use client';

import { ChevronDown, X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/cn';

interface Role {
  readonly id: string;
  readonly name: string;
  readonly color: number;
}

interface RoleMultiPickerProps {
  readonly roles: readonly Role[];
  readonly value: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly id?: string;
  readonly placeholder?: string;
}

/**
 * Chip-style multi-select for Discord roles. Native <details>+<select>
 * via a custom dropdown so it's keyboard accessible without pulling in
 * Radix's Combobox wiring (which we haven't installed yet).
 *
 * Selected roles render as removable chips above the dropdown trigger.
 * The trigger itself opens a scrollable list; clicking a role toggles
 * it in/out of the selection.
 */
export function RoleMultiPicker({
  roles,
  value,
  onChange,
  id,
  placeholder = 'Select roles',
}: RoleMultiPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (containerRef.current === null) return;
      if (e.target instanceof Node && containerRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open]);

  const selectedRoles = React.useMemo(
    () => value.map((v) => roles.find((r) => r.id === v)).filter((r): r is Role => r !== undefined),
    [roles, value],
  );

  function toggle(roleId: string): void {
    if (value.includes(roleId)) {
      onChange(value.filter((v) => v !== roleId));
    } else {
      onChange([...value, roleId]);
    }
  }

  function remove(roleId: string): void {
    onChange(value.filter((v) => v !== roleId));
  }

  function colorToHex(color: number): string {
    if (color === 0) return 'var(--color-fg-muted)';
    return `#${color.toString(16).padStart(6, '0')}`;
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
        }}
        className={cn(
          'flex min-h-9 w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selectedRoles.length === 0 ? (
          <span className="text-[color:var(--color-fg-muted)]">{placeholder}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {selectedRoles.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-2 py-0.5 text-xs"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colorToHex(r.color) }}
                  aria-hidden="true"
                />
                <span>{r.name}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(r.id);
                  }}
                  className="ml-0.5 text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
                  aria-label={`Remove ${r.name}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <ChevronDown
          className="h-4 w-4 shrink-0 text-[color:var(--color-fg-muted)]"
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius)] border bg-[color:var(--color-bg)] p-1 shadow-sm">
          {roles.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[color:var(--color-fg-muted)]">
              No roles available.
            </p>
          ) : (
            roles.map((r) => {
              const checked = value.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    toggle(r.id);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition-colors hover:bg-[color:var(--color-bg-subtle)]',
                    checked && 'bg-[color:var(--color-bg-subtle)]',
                  )}
                  role="option"
                  aria-selected={checked}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorToHex(r.color) }}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{r.name}</span>
                  {checked ? (
                    <span className="text-xs text-[color:var(--color-accent)]">selected</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
