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
 * UI-only column type. `'workflow'` is a virtual selection that lets the user
 * configure a workflow group from the sidebar; on save, it expands into N real
 * scalar columns + one workflow group, none of which carry a `'workflow'` type.
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
