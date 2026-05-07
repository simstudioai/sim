import type React from 'react'
import {
  Calendar as CalendarIcon,
  PlayOutline,
  TypeBoolean,
  TypeJson,
  TypeNumber,
  TypeText,
} from '@/components/emcn/icons'
import type { ColumnDefinition } from '@/lib/table'

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

export const COLUMN_TYPE_OPTIONS: ColumnTypeOption[] = [
  { type: 'string', label: 'Text', icon: TypeText },
  { type: 'number', label: 'Number', icon: TypeNumber },
  { type: 'boolean', label: 'Boolean', icon: TypeBoolean },
  { type: 'date', label: 'Date', icon: CalendarIcon },
  { type: 'json', label: 'JSON', icon: TypeJson },
  { type: 'workflow', label: 'Workflow', icon: PlayOutline },
]

/** Plain column types (no workflow). Used by `<ColumnConfigSidebar>`'s type combobox in edit mode. */
export const PLAIN_COLUMN_TYPE_OPTIONS = COLUMN_TYPE_OPTIONS.filter((o) => o.type !== 'workflow')
