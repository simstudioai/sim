'use client'

import { useMemo } from 'react'
import { ChipCombobox, type ComboboxOption } from '@sim/emcn'
import type { TableModuleConfig } from '@/lib/interfaces'
import { InspectorField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/inspector-field'
import { useTablesList } from '@/hooks/queries/tables'

export interface TableModuleFieldsProps {
  workspaceId: string
  value: TableModuleConfig
  /**
   * The second argument reports whether the emitted config is safe to persist.
   * A table binding has no invalid intermediate state — an unresolvable id is
   * tolerated by design — so this section always reports `true`.
   */
  onChange: (next: TableModuleConfig, isValid: boolean) => void
  disabled?: boolean
}

/**
 * Config section for a table module: the one workspace table it renders.
 *
 * The picker gains a leading `None` entry once a table is bound so the binding
 * can be cleared, and surfaces an error when the bound id no longer resolves —
 * layout validation only guards writes, so a table deleted after wiring stays
 * in the config until the user repoints it.
 */
export function TableModuleFields({
  workspaceId,
  value,
  onChange,
  disabled = false,
}: TableModuleFieldsProps) {
  const tables = useTablesList(workspaceId)

  const options = useMemo<ComboboxOption[]>(() => {
    const list = (tables.data ?? []).map((table) => ({ label: table.name, value: table.id }))
    if (!value.tableId) return list
    return [{ label: 'None', value: '' }, ...list]
  }, [tables.data, value.tableId])

  const tableMissing =
    value.tableId !== null &&
    tables.data !== undefined &&
    !tables.data.some((table) => table.id === value.tableId)

  return (
    <InspectorField
      title='Table'
      hint='The module renders the table read-only.'
      error={tableMissing ? 'This table is no longer in the workspace.' : undefined}
    >
      <ChipCombobox
        options={options}
        value={value.tableId ?? ''}
        onChange={(next) => onChange({ tableId: next === '' ? null : next }, true)}
        placeholder='Select a table'
        searchable
        searchPlaceholder='Search tables...'
        emptyMessage='No tables in this workspace'
        isLoading={tables.isLoading}
        disabled={disabled}
        maxHeight={260}
        aria-label='Table'
      />
    </InspectorField>
  )
}
