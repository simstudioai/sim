'use client'

import type { TableModuleConfig } from '@/lib/interfaces/types'
import { ResourcePickerField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/resource-picker-field'
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

/** Config section for a table module: the one workspace table it renders. */
export function TableModuleFields({
  workspaceId,
  value,
  onChange,
  disabled = false,
}: TableModuleFieldsProps) {
  const tables = useTablesList(workspaceId)

  return (
    <ResourcePickerField
      title='Table'
      missingMessage='This table is no longer in the workspace.'
      placeholder='Select a table'
      searchPlaceholder='Search tables...'
      emptyMessage='No tables in this workspace'
      items={tables.data}
      isLoading={tables.isLoading}
      value={value.tableId}
      onChange={(next) => onChange({ tableId: next }, true)}
      disabled={disabled}
    />
  )
}
