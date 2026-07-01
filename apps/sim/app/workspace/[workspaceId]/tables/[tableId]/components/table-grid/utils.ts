import type { ActiveDispatch } from '@/lib/api/contracts/tables'
import type {
  ColumnDefinition,
  RowExecutionMetadata,
  RowExecutions,
  TableRow as TableRowType,
  WorkflowGroup,
} from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import { areGroupDepsSatisfied, areOutputsFilled } from '@/lib/table/deps'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import type { DisplayColumn } from './types'

/**
 * `all` means "every row matching the active filter" — including rows not yet loaded by the
 * virtualized grid. `excluded` holds rows deselected after a select-all, so the pair maps directly
 * onto the async delete job's `{ filter, excludeRowIds }`.
 */
export type RowSelection =
  | { kind: 'none' }
  | { kind: 'some'; ids: Set<string> }
  | { kind: 'all'; excluded?: Set<string> }

export const ROW_SELECTION_NONE: RowSelection = { kind: 'none' }
export const ROW_SELECTION_ALL: RowSelection = { kind: 'all' }

export function rowSelectionIncludes(sel: RowSelection, id: string): boolean {
  if (sel.kind === 'all') return !sel.excluded?.has(id)
  if (sel.kind === 'some') return sel.ids.has(id)
  return false
}

export function rowSelectionIsEmpty(sel: RowSelection): boolean {
  if (sel.kind === 'none') return true
  if (sel.kind === 'some') return sel.ids.size === 0
  return false
}

export function rowSelectionMaterialize(sel: RowSelection, rows: TableRowType[]): Set<string> {
  if (sel.kind === 'all')
    return new Set(rows.filter((r) => !sel.excluded?.has(r.id)).map((r) => r.id))
  if (sel.kind === 'some') return new Set(sel.ids)
  return new Set<string>()
}

export function rowSelectionCoversAll(sel: RowSelection, rows: TableRowType[]): boolean {
  if (rows.length === 0) return false
  if (sel.kind === 'all') return !rows.some((r) => sel.excluded?.has(r.id))
  if (sel.kind === 'none') return false
  if (sel.ids.size < rows.length) return false
  for (const r of rows) if (!sel.ids.has(r.id)) return false
  return true
}

/** Returns sticky row-number column dimensions sized to the digit count of `rowCount`. */
export function checkboxColLayout(
  rowCount: number,
  hasWorkflowCols: boolean
): { colWidth: number; numRegionWidth: number } {
  const digits = rowCount > 0 ? Math.floor(Math.log10(rowCount)) + 1 : 1
  const numWidth = Math.max(20, digits * 8 + 4)
  // Region the number/checkbox is centered within (digit width + 12px breathing
  // room, min 32). The select-all header checkbox centers in the same region so it
  // lines up with the per-row checkboxes.
  const numRegionWidth = Math.max(32, numWidth + 12)
  // Workflow tables add a 20px run/stop button (+6px gap, +4px pad) to the right of
  // the region; the checkbox stays centered in the space that remains.
  const colWidth = numRegionWidth + (hasWorkflowCols ? 30 : 0)
  return { colWidth, numRegionWidth }
}

export interface CellCoord {
  rowIndex: number
  colIndex: number
}

export interface NormalizedSelection {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
  anchorRow: number
  anchorCol: number
}

/** A run of consecutive `displayColumns` rendered together in the meta header row. */
export type HeaderGroup =
  | { kind: 'plain'; size: 1; startColIndex: number }
  | {
      kind: 'workflow'
      size: number
      startColIndex: number
      groupId: string
      workflowId: string
    }

/**
 * Flat schema → one DisplayColumn per ColumnDefinition. Pre-pass computes
 * `groupSize` and `groupStartColIndex` for every consecutive run of columns
 * sharing a `workflowGroupId`. Validation guarantees cohesion; the renderer
 * just walks sequentially.
 */
export function expandToDisplayColumns(
  columns: ColumnDefinition[],
  workflowGroups: WorkflowGroup[]
): DisplayColumn[] {
  const out: DisplayColumn[] = []
  const groupById = new Map(workflowGroups.map((g) => [g.id, g]))

  for (let i = 0; i < columns.length; ) {
    const column = columns[i]
    const gid = column.workflowGroupId
    if (gid) {
      let size = 1
      while (i + size < columns.length && columns[i + size].workflowGroupId === gid) {
        size++
      }
      const group = groupById.get(gid)
      // Pre-index outputs by column name for O(1) lookup. First output wins on a
      // duplicate columnName, exactly matching the previous `Array.find()` behavior.
      const outputByColumnName = new Map<string, WorkflowGroup['outputs'][number]>()
      if (group) {
        for (const o of group.outputs) {
          if (!outputByColumnName.has(o.columnName)) outputByColumnName.set(o.columnName, o)
        }
      }
      const startIdx = out.length
      for (let k = 0; k < size; k++) {
        const child = columns[i + k]
        const output = outputByColumnName.get(getColumnId(child))
        out.push({
          ...child,
          key: getColumnId(child),
          outputBlockId: output?.blockId,
          outputPath: output?.path,
          groupSize: size,
          groupStartColIndex: startIdx,
          headerLabel: child.name,
          isGroupStart: k === 0,
        })
      }
      i += size
    } else {
      out.push({
        ...column,
        key: getColumnId(column),
        groupSize: 1,
        groupStartColIndex: out.length,
        headerLabel: column.name,
        isGroupStart: true,
      })
      i += 1
    }
  }
  return out
}

export function buildHeaderGroups(
  displayColumns: DisplayColumn[],
  workflowGroups: WorkflowGroup[]
): HeaderGroup[] {
  const groupById = new Map(workflowGroups.map((g) => [g.id, g]))
  const groups: HeaderGroup[] = []
  for (let i = 0; i < displayColumns.length; ) {
    const col = displayColumns[i]
    if (col.workflowGroupId && col.isGroupStart) {
      const group = groupById.get(col.workflowGroupId)
      if (group) {
        groups.push({
          kind: 'workflow',
          size: col.groupSize,
          startColIndex: i,
          groupId: col.workflowGroupId,
          workflowId: group.workflowId,
        })
        i += col.groupSize
        continue
      }
    }
    groups.push({ kind: 'plain', size: 1, startColIndex: i })
    i += 1
  }
  return groups
}

/** Reads the per-group execution state for a row, defaulting to empty. */
export function readExecution(
  row: { executions?: RowExecutions } | null | undefined,
  groupId: string | undefined
): RowExecutionMetadata | undefined {
  if (!groupId) return undefined
  return row?.executions?.[groupId]
}

/**
 * Resolves a cell's execution state with the "about to run" overlay applied:
 * for cells in an active dispatch's scope ahead of its cursor whose deps are
 * already satisfied, returns a synthetic `pending` exec so the renderer
 * shows `Queued`. Cells with a real DB exec always win — the overlay only
 * fills the gap between dispatch start and the dispatcher's per-row pending
 * stamp. Cells with unmet deps still render as `Waiting` (the renderer
 * computes that from `waitingOnLabels`).
 */
export function resolveCellExec(
  row: TableRowType,
  group: WorkflowGroup | undefined,
  activeDispatches: ActiveDispatch[] | undefined
): RowExecutionMetadata | undefined {
  if (!group) return undefined
  const real = row.executions?.[group.id]
  if (real) return real
  if (!activeDispatches || activeDispatches.length === 0) return undefined
  if (areOutputsFilled(group, row)) return undefined
  if (!areGroupDepsSatisfied(group, row)) return undefined
  for (const d of activeDispatches) {
    // Capped dispatches run only the first N eligible rows ahead of the
    // cursor, and this per-row resolver can't tell which rows fall within the
    // budget — rendering every ahead-of-cursor row as Queued would massively
    // over-count. The dispatcher's real per-row pending stamps (arriving via
    // cell SSE) cover the actual rows instead.
    if (d.limit) continue
    if (!d.scope.groupIds.includes(group.id)) continue
    // Auto-fire dispatches (row writes / schema changes) scope every group but
    // the dispatcher honors `autoRun: false` per-cell ('autoRun-off'), so those
    // cells never actually run — don't optimistically paint them Queued. Manual
    // runs (Run all / Run column) bypass autoRun and DO run them, so keep the
    // overlay's Queued there.
    if (!d.isManualRun && group.autoRun === false) continue
    if (d.scope.rowIds && !d.scope.rowIds.includes(row.id)) continue
    if (row.position <= d.cursor) continue
    return {
      status: 'pending',
      executionId: null,
      jobId: null,
      workflowId: group.workflowId,
      error: null,
    }
  }
  return undefined
}

export interface ExecStatusMix {
  hasIncompleteOrFailed: boolean
  hasCompleted: boolean
  hasInFlight: boolean
}

/**
 * Walks `(rowIdSet × groupIds)` exec statuses on `rows` and reports which
 * status buckets are present. Short-circuits once all three buckets are
 * observed and once every selected row has been visited. Drives Play /
 * Refresh / Stop visibility on the action bar and the context menu — both
 * surfaces use the same shape so they stay in sync.
 */
export function classifyExecStatusMix(
  rows: TableRowType[],
  rowIdSet: ReadonlySet<string>,
  groupIds: readonly string[]
): ExecStatusMix {
  const result: ExecStatusMix = {
    hasIncompleteOrFailed: false,
    hasCompleted: false,
    hasInFlight: false,
  }
  if (rowIdSet.size === 0 || groupIds.length === 0) return result
  const target = rowIdSet.size
  let seen = 0
  for (const row of rows) {
    if (!rowIdSet.has(row.id)) continue
    seen++
    for (const groupId of groupIds) {
      const status = readExecution(row, groupId)?.status
      if (status === 'queued' || status === 'running' || status === 'pending') {
        result.hasInFlight = true
      } else if (status === 'completed') {
        result.hasCompleted = true
      } else {
        result.hasIncompleteOrFailed = true
      }
      if (result.hasInFlight && result.hasCompleted && result.hasIncompleteOrFailed) {
        return result
      }
    }
    if (seen === target) break
  }
  return result
}

export function moveCell(
  anchor: CellCoord,
  colCount: number,
  totalRows: number,
  direction: 1 | -1
): CellCoord {
  let newCol = anchor.colIndex + direction
  let newRow = anchor.rowIndex
  if (newCol >= colCount) {
    newCol = 0
    newRow = Math.min(totalRows - 1, newRow + 1)
  } else if (newCol < 0) {
    newCol = colCount - 1
    newRow = Math.max(0, newRow - 1)
  }
  return { rowIndex: newRow, colIndex: newCol }
}

export function computeNormalizedSelection(
  anchor: CellCoord | null,
  focus: CellCoord | null
): NormalizedSelection | null {
  if (!anchor) return null
  const f = focus ?? anchor
  return {
    startRow: Math.min(anchor.rowIndex, f.rowIndex),
    endRow: Math.max(anchor.rowIndex, f.rowIndex),
    startCol: Math.min(anchor.colIndex, f.colIndex),
    endCol: Math.max(anchor.colIndex, f.colIndex),
    anchorRow: anchor.rowIndex,
    anchorCol: anchor.colIndex,
  }
}

export function collectRowSnapshots(rows: Iterable<TableRowType>): DeletedRowSnapshot[] {
  const snapshots: DeletedRowSnapshot[] = []
  for (const row of rows) {
    snapshots.push({
      rowId: row.id,
      data: { ...row.data },
      position: row.position,
      orderKey: row.orderKey,
    })
  }
  return snapshots
}
