'use client'

import type React from 'react'
import {
  Calendar as CalendarIcon,
  PlayOutline,
  TypeBoolean,
  TypeJson,
  TypeNumber,
  TypeText,
} from '@/components/emcn/icons'
import type { BlockIconInfo } from '../types'

export const COLUMN_TYPE_ICONS: Record<string, React.ElementType> = {
  string: TypeText,
  number: TypeNumber,
  boolean: TypeBoolean,
  date: CalendarIcon,
  json: TypeJson,
}

interface ColumnTypeIconProps {
  type: string
  /** True for workflow-output columns; renders the producing block's icon
   *  (or a workflow fallback) instead of the scalar type icon. Workflow
   *  columns ARE stored as scalar types, so without this `type` would
   *  otherwise resolve to e.g. `string` and read identically to a plain
   *  text column. */
  isWorkflowColumn?: boolean
  /** Block-icon info from the source-info builder, used for workflow columns
   *  to surface the producing block's icon. The block's color is intentionally
   *  ignored — icons render in the plain `text-[var(--text-icon)]` tone like
   *  every other column-type icon, no per-block tint. */
  blockIconInfo?: BlockIconInfo
}

/**
 * Tiny icon shown next to a column header. Workflow-output columns get the
 * producing block's icon (falling back to `PlayOutline`); plain columns get
 * their scalar type icon. Both render in the same `text-[var(--text-icon)]`
 * tone — no per-workflow color, no colored swatch.
 */
export function ColumnTypeIcon({ type, isWorkflowColumn, blockIconInfo }: ColumnTypeIconProps) {
  if (isWorkflowColumn) {
    const Icon = blockIconInfo?.icon ?? PlayOutline
    return <Icon className='h-3 w-3 shrink-0 text-[var(--text-icon)]' />
  }
  const Icon = COLUMN_TYPE_ICONS[type] ?? TypeText
  return <Icon className='h-3 w-3 shrink-0 text-[var(--text-icon)]' />
}
