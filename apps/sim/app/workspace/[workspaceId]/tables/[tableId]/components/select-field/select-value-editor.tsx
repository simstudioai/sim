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
  /** Open the menu on mount (inline cell editing). */
  defaultOpen?: boolean
  /** Fired whenever the menu opens or closes. */
  onOpenChange?: (open: boolean) => void
  fullWidth?: boolean
  align?: 'start' | 'center' | 'end'
}

const CLEAR_VALUE = ''

/**
 * Shared option picker for `select`/`multiselect` cells, used by the inline
 * editor, expanded popover, and row modal. Renders each option as its colored
 * pill and writes option ids back through `onChange`.
 */
export function SelectValueEditor({
  column,
  value,
  onChange,
  defaultOpen,
  onOpenChange,
  fullWidth,
  align = 'start',
}: SelectValueEditorProps) {
  const isMulti = column.type === 'multiselect'
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
        onChange={(ids) => onChange(ids)}
        options={options}
        showAllOption={false}
        placeholder='Select options'
        align={align}
        fullWidth={fullWidth}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
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
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      matchTriggerWidth={false}
    />
  )
}
