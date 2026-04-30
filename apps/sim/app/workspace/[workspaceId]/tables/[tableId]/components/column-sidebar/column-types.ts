import type React from 'react'
import {
  Calendar as CalendarIcon,
  TypeBoolean,
  TypeJson,
  TypeNumber,
  TypeText,
} from '@/components/emcn/icons'
import type { ColumnDefinition } from '@/lib/table'

export interface ColumnTypeOption {
  type: ColumnDefinition['type']
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export const COLUMN_TYPE_OPTIONS: ColumnTypeOption[] = [
  { type: 'string', label: 'Text', icon: TypeText },
  { type: 'number', label: 'Number', icon: TypeNumber },
  { type: 'boolean', label: 'Boolean', icon: TypeBoolean },
  { type: 'date', label: 'Date', icon: CalendarIcon },
  { type: 'json', label: 'JSON', icon: TypeJson },
]
