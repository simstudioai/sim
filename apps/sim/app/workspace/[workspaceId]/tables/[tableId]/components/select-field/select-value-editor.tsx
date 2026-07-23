'use client'

import { useMemo } from 'react'
import { ChipDropdown } from '@sim/emcn'
import type { ColumnDefinition } from '@/lib/table'
import { SelectPill, toSelectedIds } from './select-pill'

interface SelectValueEditorProps {
  column: ColumnDefinition
  value: unknown
  /** Single columns emit a string id or null; multiselect emits a string[]. */
  onChange: (next: string | string[] | null) => void
  fullWidth?: boolean
  align?: 'start' | 'center' | 'end'
}

const CLEAR_VALUE = ''

/**
 * Option picker for `select`/`multiselect` cells in a form context (the row
 * modal) — a `ChipDropdown` pill that lists each option as its colored pill and
 * writes option ids back through `onChange`. Inline grid editing uses a bare
 * `DropdownMenu` instead (see `InlineSelectEditor`).
 */
export function SelectValueEditor({
  column,
  value,
  onChange,
  fullWidth,
  align = 'start',
}: SelectValueEditorProps) {
  const isMulti = !!column.multiple
  const options = useMemo(
    () =>
      (column.options ?? []).map((option) => ({
        value: option.id,
        label: <SelectPill option={option} />,
      })),
    [column.options]
  )

  if (isMulti) {
    return (
      <ChipDropdown
        multiple
        value={toSelectedIds(value)}
        // A required multiselect can't be emptied — ignore the toggle that would
        // remove the last option, since an empty selection can never be committed.
        onChange={(ids) => {
          if (column.required && ids.length === 0) return
          onChange(ids)
        }}
        options={options}
        showAllOption={false}
        placeholder='Select options'
        align={align}
        fullWidth={fullWidth}
        matchTriggerWidth={false}
      />
    )
  }

  // Offer a "None" entry to clear the cell — except on a required column, where
  // clearing to null can never be committed (required validation rejects it).
  const singleOptions = column.required
    ? options
    : [
        { value: CLEAR_VALUE, label: <span className='text-[var(--text-muted)]'>None</span> },
        ...options,
      ]

  return (
    <ChipDropdown
      value={toSelectedIds(value)[0] ?? CLEAR_VALUE}
      onChange={(id) => onChange(id === CLEAR_VALUE ? null : id)}
      options={singleOptions}
      placeholder='Select an option'
      align={align}
      fullWidth={fullWidth}
      matchTriggerWidth={false}
    />
  )
}
