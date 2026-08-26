import type React from 'react'
import { PlayOutline } from '@sim/emcn/icons'
import type { ColumnDefinition } from '@/lib/table'
import { ALL_COLUMN_TYPES, wouldExceedColumnTypeLimit } from '@/lib/table/column-types'

/**
 * UI-only column type. `'workflow'` is the virtual entry users pick from the
 * "+ New column" dropdown to spawn a workflow group; the resulting columns are
 * stored as scalar types under the hood (none carry `'workflow'`).
 */
export type SidebarColumnType = ColumnDefinition['type'] | 'workflow'

export interface ColumnTypeOption {
  type: SidebarColumnType
  label: string
  icon: React.ComponentType<{ className?: string }>
  maxPerTable?: number
  disabledReason?: string
}

/**
 * Real column types come from the registry — adding one there makes it appear
 * in every picker automatically. `workflow` is appended because it is a UI
 * affordance, not a storable type.
 */
export const COLUMN_TYPE_OPTIONS: ColumnTypeOption[] = [
  ...ALL_COLUMN_TYPES.map((definition) => ({
    type: definition.id,
    label: definition.label,
    icon: definition.icon,
    maxPerTable: definition.maxPerTable,
  })),
  { type: 'workflow', label: 'Workflow', icon: PlayOutline },
]

/** Plain column types (no workflow). Used by the column type combobox in edit mode. */
export const PLAIN_COLUMN_TYPE_OPTIONS = COLUMN_TYPE_OPTIONS.filter(
  (option) => option.type !== 'workflow'
)

function columnTypeLimitMessage(label: string, maxPerTable: number): string {
  return maxPerTable === 1
    ? `Only one ${label} column allowed per table`
    : `Only ${maxPerTable} ${label} columns allowed per table`
}

/** Picker entries with unavailable cardinality-limited types marked as disabled. */
export function columnTypeOptionsForTable(
  columns: readonly ColumnDefinition[],
  currentColumn?: ColumnDefinition | null
): ColumnTypeOption[] {
  return COLUMN_TYPE_OPTIONS.map((option) => {
    if (option.type === 'workflow') return option
    if (currentColumn?.type === option.type) return option
    if (option.maxPerTable === undefined) return option
    if (!wouldExceedColumnTypeLimit(columns, option.type, 1)) return option
    return {
      ...option,
      disabledReason: columnTypeLimitMessage(option.label, option.maxPerTable),
    }
  })
}
