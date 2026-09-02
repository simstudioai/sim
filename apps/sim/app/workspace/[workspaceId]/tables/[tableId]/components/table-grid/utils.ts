import type { ActiveDispatch } from '@/lib/api/contracts/tables'
import {
  buildTableSelectionLabel,
  MAX_TABLE_SELECTION_COLUMNS,
  MAX_TABLE_SELECTION_ROWS,
} from '@/lib/copilot/chat/selection-context'
import type {
  ColumnDefinition,
  RowExecutionMetadata,
  RowExecutions,
  TableRow as TableRowType,
  WorkflowGroup,
} from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import { columnTypeOf } from '@/lib/table/column-types'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { areGroupDepsSatisfied, areOutputsFilled } from '@/lib/table/deps'
import type {
  DisplayColumn,
  ReferencePreviewTarget,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/types'
import type { ChatContext } from '@/stores/panel'
import type { DeletedRowSnapshot } from '@/stores/table/types'

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

export function isSameReferencePreviewTarget(
  left: ReferencePreviewTarget | null,
  right: ReferencePreviewTarget
): boolean {
  return (
    left?.sourceRowId === right.sourceRowId &&
    left.sourceColumnKey === right.sourceColumnKey &&
    left.referenceTableId === right.referenceTableId &&
    left.referenceRowId === right.referenceRowId
  )
}

interface HorizontalEdgeScrollVelocityInput {
  pointerX: number
  visibleLeft: number
  visibleRight: number
  hotZone: number
  maxVelocity: number
}

export function horizontalEdgeScrollVelocity({
  pointerX,
  visibleLeft,
  visibleRight,
  hotZone,
  maxVelocity,
}: HorizontalEdgeScrollVelocityInput): number {
  if (hotZone <= 0) throw new Error('hotZone must be greater than zero')
  if (maxVelocity <= 0) throw new Error('maxVelocity must be greater than zero')
  const visibleWidth = visibleRight - visibleLeft
  if (visibleWidth <= 0) return 0

  const edgeZone = Math.min(hotZone, visibleWidth / 2)

  const distanceFromLeft = pointerX - visibleLeft
  if (distanceFromLeft < edgeZone) {
    const intensity = 1 - Math.max(0, distanceFromLeft) / edgeZone
    return -Math.ceil(intensity * maxVelocity)
  }

  const distanceFromRight = visibleRight - pointerX
  if (distanceFromRight < edgeZone) {
    const intensity = 1 - Math.max(0, distanceFromRight) / edgeZone
    return Math.ceil(intensity * maxVelocity)
  }

  return 0
}

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

/**
 * Whether a (row, col) index pair falls inside a normalized selection rectangle.
 * Row/col may be `undefined` (e.g. an id that didn't resolve to an index) → `false`.
 */
export function isCellInSelection(
  row: number | undefined,
  col: number | undefined,
  sel: NormalizedSelection
): boolean {
  return (
    row !== undefined &&
    col !== undefined &&
    row >= sel.startRow &&
    row <= sel.endRow &&
    col >= sel.startCol &&
    col <= sel.endCol
  )
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

function resolveReferenceTableName(
  column: ColumnDefinition,
  referenceTableNames: ReadonlyMap<string, string> | undefined
): string | undefined {
  const tableId = columnTypeOf(column).referencePreview?.getTableId(column)
  return tableId ? referenceTableNames?.get(tableId) : undefined
}

/**
 * Flat schema → one DisplayColumn per ColumnDefinition. Pre-pass computes
 * `groupSize` and `groupStartColIndex` for every consecutive run of columns
 * sharing a `workflowGroupId`. Validation guarantees cohesion; the renderer
 * just walks sequentially.
 */
export function expandToDisplayColumns(
  columns: ColumnDefinition[],
  workflowGroups: WorkflowGroup[],
  referenceTableNames?: ReadonlyMap<string, string>
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
          referenceTableName: resolveReferenceTableName(child, referenceTableNames),
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
        referenceTableName: resolveReferenceTableName(column, referenceTableNames),
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

/** Column ids spanned by a normalized selection's column range. */
export function selectedColumnIds(
  columns: DisplayColumn[],
  selection: { startCol: number; endCol: number }
): string[] {
  const ids: string[] = []
  for (let c = selection.startCol; c <= selection.endCol && c < columns.length; c++) {
    ids.push(getColumnId(columns[c]))
  }
  return ids
}

/**
 * Materializes a `table_selection` chat context from a grid selection, applying
 * the shared row/column caps. `columnIds` narrows the context to a cell range;
 * omit it for a whole-row selection, where the agent should see every column.
 * Returns null before the table name has loaded or when nothing is selected.
 *
 * A range is never widened back to an open scope for "covering everything":
 * the only counts available to callers come from the rendered grid, which both
 * drops hidden columns and expands workflow groups, so "all of them" cannot be
 * compared to the schema. Treating a full-width range as whole rows would let
 * the server re-fetch columns the user had hidden.
 */
export function buildTableSelectionContext(opts: {
  tableId: string
  tableName: string | undefined
  rowIds: string[]
  columnIds?: string[]
}): ChatContext | null {
  const { tableId, tableName, columnIds } = opts
  if (!tableName || opts.rowIds.length === 0) return null
  const rowIds = opts.rowIds.slice(0, MAX_TABLE_SELECTION_ROWS)
  const scopedColumnIds =
    columnIds && columnIds.length > 0 ? columnIds.slice(0, MAX_TABLE_SELECTION_COLUMNS) : undefined
  return {
    kind: 'table_selection',
    tableId,
    tableName,
    label: buildTableSelectionLabel(tableName, rowIds.length, scopedColumnIds?.length),
    rowIds,
    ...(scopedColumnIds ? { columnIds: scopedColumnIds } : {}),
  }
}

/**
 * How many rows to load before building a select-all chip. A gutter select-all
 * can carry exclusions anywhere in the table, and they are filtered out AFTER
 * loading — so loading only {@link MAX_TABLE_SELECTION_ROWS} yields fewer than
 * the cap whenever an excluded row sits in that prefix, leaving the chip short
 * of the count the menu advertised. Loading the cap plus the exclusion count
 * covers the worst case, where every exclusion falls inside the prefix.
 */
export function drainTargetForChip(excludedCount: number): number {
  return MAX_TABLE_SELECTION_ROWS + excludedCount
}

/**
 * Rows a chip will actually reference for a selection of `requested` rows —
 * {@link buildTableSelectionContext} caps its `rowIds`, so any count shown to
 * the user must pass through here or the UI promises more than it sends.
 */
export function chipRowCount(requested: number): number {
  return Math.min(requested, MAX_TABLE_SELECTION_ROWS)
}

/**
 * Whether a copy can be written synchronously on the event — the only way a
 * chat-selection chip survives, since the paged path's async Clipboard API write
 * replaces the whole clipboard and cannot carry a custom MIME type.
 *
 * Bounded by the TEXT limit, not the chip's row cap: a context slices its own
 * `rowIds` to {@link MAX_TABLE_SELECTION_ROWS}, so a larger selection should
 * still copy in full here and carry a chip for as many rows as a chip can
 * reference — matching what Add to Chat does with the same selection. Gating on
 * the chip cap instead drops the chip entirely. Past `MAX_COPY_ROWS` the paged
 * path must take over, because it owns truncation and its user-facing notice.
 *
 * @param complete - Whether the caller's rows are everything the copy should
 * contain. False when the paged path would load rows the caller cannot see yet,
 * so deferring to it copies strictly more.
 */
export function canWriteRowsWithChip(opts: {
  rowCount: number
  complete: boolean
  hasContext: boolean
}): boolean {
  if (!opts.hasContext || !opts.complete) return false
  return opts.rowCount > 0 && opts.rowCount <= TABLE_LIMITS.MAX_COPY_ROWS
}
