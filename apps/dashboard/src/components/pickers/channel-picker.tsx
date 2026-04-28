'use client';

import { Hash, Megaphone } from 'lucide-react';
import * as React from 'react';

interface Channel {
  readonly id: string;
  readonly name: string;
  readonly type: 'text' | 'announcement';
}

interface ChannelPickerProps {
  readonly channels: readonly Channel[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly placeholder?: string;
  readonly id?: string;
}

/**
 * Native select — small, accessible, no dependencies. The shadcn `Select`
 * primitive is overkill for a textual list. When forms grow we can swap
 * in a Combobox (Radix Popover + Command) without changing the prop API.
 */
export function ChannelPicker({
  channels,
  value,
  onChange,
  placeholder = 'Select a channel',
  id,
}: ChannelPickerProps): React.JSX.Element {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="flex h-9 w-full appearance-none rounded-[var(--radius)] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] pl-8 pr-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
      >
        <option value="">{placeholder}</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.type === 'announcement' ? '📢 ' : '# '}
            {c.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[color:var(--color-fg-muted)]">
        {(() => {
          const selected = channels.find((c) => c.id === value);
          if (selected?.type === 'announcement') {
            return <Megaphone className="h-4 w-4" aria-hidden="true" />;
          }
          return <Hash className="h-4 w-4" aria-hidden="true" />;
        })()}
      </span>
    </div>
  );
}
