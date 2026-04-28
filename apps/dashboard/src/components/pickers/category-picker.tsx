'use client';

import { Folder } from 'lucide-react';
import * as React from 'react';

interface Category {
  readonly id: string;
  readonly name: string;
}

interface CategoryPickerProps {
  readonly categories: readonly Category[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly placeholder?: string;
  readonly id?: string;
}

export function CategoryPicker({
  categories,
  value,
  onChange,
  placeholder = 'Select a category',
  id,
}: CategoryPickerProps): React.JSX.Element {
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
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Folder
        className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-fg-muted)]"
        aria-hidden="true"
      />
    </div>
  );
}
