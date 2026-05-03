import type React from 'react'
import type { ColumnDefinition } from '@/lib/table'

export interface BlockIconInfo {
  icon: React.ComponentType<{ className?: string }>
  color: string
}

export interface ColumnSourceInfo {
  blockIconInfo?: BlockIconInfo
  blockName?: string
}

/**
 * One visual column in the rendered grid. With the flat schema there's exactly
 * one DisplayColumn per ColumnDefinition — no fan-out. Workflow grouping is
 * derived from `column.workflowGroupId` and rendered as a meta-header banner.
 */
export interface DisplayColumn extends ColumnDefinition {
  /** Stable per-visual-column identifier (= column.name). */
  key: string
  /** Block id producing this column's value (workflow-output columns only). */
  outputBlockId?: string
  /** Pluck path the workflow ran for this column. */
  outputPath?: string
  /** Number of consecutive sibling columns sharing this group (1 for plain). */
  groupSize: number
  /** colIndex of the first sibling within `displayColumns`. */
  groupStartColIndex: number
  /** Header label shown above this visual column. */
  headerLabel: string
  /** True when this is the leftmost sibling of its group (or non-grouped). */
  isGroupStart: boolean
}
