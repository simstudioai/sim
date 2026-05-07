import type {
  ColumnDefinition,
  RowExecutionMetadata,
  RowExecutions,
  TableRow as TableRowType,
  WorkflowGroup,
} from '@/lib/table'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import type { DisplayColumn } from './types'

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
      const startIdx = out.length
      for (let k = 0; k < size; k++) {
        const child = columns[i + k]
        const output = group?.outputs.find((o) => o.columnName === child.name)
        out.push({
          ...child,
          key: child.name,
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
        key: column.name,
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
    snapshots.push({ rowId: row.id, data: { ...row.data }, position: row.position })
  }
  return snapshots
}
