'use client'

import type React from 'react'
import { Tooltip } from '@/components/emcn'
import {
  Calendar as CalendarIcon,
  PlayOutline,
  TypeBoolean,
  TypeJson,
  TypeNumber,
  TypeText,
  WorkflowX,
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
  /** Workflow-output column whose source block no longer exists in the
   *  workflow — renders the `WorkflowX` "not found" icon with a tooltip. */
  blockMissing?: boolean
}

/**
 * Tiny icon shown next to a column header. Workflow-output columns get the
 * producing block's icon (falling back to `PlayOutline`); plain columns get
 * their scalar type icon. Both render in the same `text-[var(--text-icon)]`
 * tone — no per-workflow color, no colored swatch. A workflow column whose
 * source block was deleted renders a `WorkflowX` with an explanatory tooltip.
 */
export function ColumnTypeIcon({
  type,
  isWorkflowColumn,
  blockIconInfo,
  blockMissing,
}: ColumnTypeIconProps) {
  if (isWorkflowColumn) {
    if (blockMissing) {
      return (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span className='flex shrink-0 items-center'>
              <WorkflowX className='size-3 shrink-0 text-[var(--text-icon)]' />
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            This column's source block no longer exists in the workflow.
          </Tooltip.Content>
        </Tooltip.Root>
      )
    }
    const Icon = blockIconInfo?.icon ?? PlayOutline
    return <Icon className='size-3 shrink-0 text-[var(--text-icon)]' />
  }
  const Icon = COLUMN_TYPE_ICONS[type] ?? TypeText
  return <Icon className='size-3 shrink-0 text-[var(--text-icon)]' />
}
