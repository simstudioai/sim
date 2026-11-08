'use client'

import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { type ColumnDefinition, getColumnId } from '@/platform/lib/data/tables'

interface RunAfterFieldProps {
  /** The columns the group may wait on: plain and workflow output columns alike. */
  columns: readonly ColumnDefinition[]
  /** The ids of the columns it waits on. */
  value: readonly string[]
  onChange: (next: string[]) => void
  error?: string
}

/**
 * Which upstream columns must be filled before a group runs. A workflow output column counts like
 * any other: once it holds a value, the dependency is met. Auto-run needs at least one.
 */
export function RunAfterField({ columns, value, onChange, error }: RunAfterFieldProps) {
  return (
    <MultiSelect
      label='Run after'
      options={columns.map((column) => ({ value: getColumnId(column), label: column.name }))}
      value={value}
      onValueChange={onChange}
      placeholder='Select at least one column'
      searchLabel='Search columns'
      disabled={columns.length === 0}
      disabledReason={columns.length === 0 ? 'No upstream columns' : undefined}
      error={error}
    />
  )
}
