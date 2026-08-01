import type React from 'react'
import { PlayOutline } from '@sim/emcn/icons'
import type { ColumnDefinition } from '@/lib/table'
import { ALL_COLUMN_TYPES } from '@/lib/table/column-types'

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
  })),
  { type: 'workflow', label: 'Workflow', icon: PlayOutline },
]

/** Plain column types (no workflow). Used by `<ColumnConfigSidebar>`'s type combobox in edit mode. */
export const PLAIN_COLUMN_TYPE_OPTIONS = COLUMN_TYPE_OPTIONS.filter((o) => o.type !== 'workflow')
