import type React from 'react'
import type { TableCellSelection } from '@sim/realtime-protocol/table-presence'
import type { ColumnDefinition, SortSpec, TablePredicate, TableRow } from '@/lib/table'

export interface BlockIconInfo {
  icon: React.ComponentType<{ className?: string }>
  color: string
}

export interface ColumnSourceInfo {
  blockIconInfo?: BlockIconInfo
  blockName?: string
  /** Workflow loaded but the column's source block no longer exists — the
   *  header renders a "Not found" badge. Only set for loaded states. */
  blockMissing?: boolean
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

/**
 * A remote viewer's current cell selection, ready to render as a presence overlay.
 *
 * Declared beside the grid's own view types rather than in the presence hook: the
 * overlay that draws it is presentational, while the hook that produces it holds an
 * authenticated socket session. Keeping the type here lets the overlay stay free of
 * any dependency on the hook.
 */
export interface RemoteTableSelection {
  socketId: string
  userId: string
  userName: string
  cell: NonNullable<TableCellSelection>
}

/**
 * Reason the inline editor completed, used to determine navigation after save
 */
export type SaveReason = 'enter' | 'tab' | 'shift-tab' | 'blur'

/**
 * Tracks which cell is currently being edited inline. `columnKey` distinguishes
 * fanned-out workflow visual columns (which share the same `columnName`) — set
 * when the interaction targets a specific visual column (e.g. expanded view),
 * omitted for plain cells.
 */
export interface EditingCell {
  rowId: string
  columnName: string
  columnKey?: string
}

/**
 * Query options for filtering and sorting table data
 */
export interface QueryOptions {
  filter: TablePredicate | null
  sort: SortSpec | null
}

/**
 * State for the row context menu (right-click).
 * When `row` is null and `rowIndex` is set, the menu targets an empty cell.
 */
export interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  row: TableRow | null
  rowIndex: number | null
  columnName: string | null
}
