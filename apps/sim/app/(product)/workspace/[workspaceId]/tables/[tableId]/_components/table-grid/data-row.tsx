'use client'

import { type MouseEvent, memo, useMemo, useRef } from 'react'
import { IconButton } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { CellContent } from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/cell-render'
import { inlineStyle } from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/inline-style'
import styles from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/table-grid.module.css'
import {
  type ActiveDispatch,
  type DisplayColumn,
  getUnmetGroupDeps,
  type NormalizedSelection,
  resolveCellExec,
  type SaveReason,
  type TableRow,
  type TimezoneState,
  type WorkflowGroup,
} from '@/platform/lib/data/tables'

interface DataRowProps {
  row: TableRow
  columns: DisplayColumn[]
  /** Forwarded to cells so in-workspace resource URLs render as resource chips. */
  workspaceId: string
  /** Whether Date values can be formatted and edited safely. */
  timezoneStatus: TimezoneState['status']
  rowIndex: number
  isFirstRow: boolean
  editingColumnName: string | null
  initialCharacter: string | null
  /** Opens cell editors read-only, e.g. on an update-locked table. */
  editorsReadOnly: boolean
  pendingCellValue: Record<string, unknown> | null
  normalizedSelection: NormalizedSelection | null
  onClick: (rowId: string, columnName: string, options?: { toggleBoolean?: boolean }) => void
  onDoubleClick: (rowId: string, columnName: string, columnKey: string) => void
  onSave: (rowId: string, columnName: string, value: unknown, reason: SaveReason) => void
  onCancel: () => void
  onContextMenu: (e: MouseEvent, row: TableRow) => void
  onCellMouseDown: (rowIndex: number, colIndex: number, shiftKey: boolean) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
  isRowChecked: boolean
  /** Keyboard (Space/Enter) toggle of the row checkbox. */
  onRowToggle: (rowIndex: number, shiftKey: boolean) => void
  /** Pointer-down on the gutter: toggles the row and arms gutter drag-select. */
  onRowMouseDown: (rowIndex: number, shiftKey: boolean) => void
  /** Pointer entering the gutter cell: extends an in-progress gutter drag. */
  onRowMouseEnter: (rowIndex: number) => void
  /** Workflow cells in this row currently running or queued. */
  runningCount: number
  /** Whether the table has a workflow column, which adds the gutter's run/stop action. */
  hasWorkflowColumns: boolean
  /** Width of the row number region, from the table's row-count digit count. */
  numRegionWidth: number
  onStopRow: (rowId: string) => void
  onRunRow: (rowId: string) => void
  /** The table's workflow groups, for the per-row "Waiting on …" labels of empty output cells. */
  workflowGroups: WorkflowGroup[]
  /** Active dispatches: rows ahead of the dispatcher's cursor render as Queued until it stamps them. */
  activeDispatches: ActiveDispatch[] | undefined
  /** Sticky `left` for each pinned column key; absent keys are not pinned. */
  pinnedOffsets?: Map<string, number>
  /** The rightmost pinned column, which draws the frozen zone's edge. */
  lastPinnedColKey?: string | null
  /**
   * Column keys in this row matching the active find query, so every hit is tinted at once. Absent
   * when the row has no match (the common case), which keeps this row's memo from re-running.
   */
  findMatchColumns?: ReadonlySet<string>
}

function cellRangeRowChanged(
  rowIndex: number,
  colCount: number,
  prev: NormalizedSelection | null,
  next: NormalizedSelection | null
): boolean {
  const pIn = prev !== null && rowIndex >= prev.startRow && rowIndex <= prev.endRow
  const nIn = next !== null && rowIndex >= next.startRow && rowIndex <= next.endRow
  const pAnchor = prev !== null && rowIndex === prev.anchorRow
  const nAnchor = next !== null && rowIndex === next.anchorRow

  if (!pIn && !nIn && !pAnchor && !nAnchor) return false
  if (pIn !== nIn || pAnchor !== nAnchor) return true

  if (prev && next && pIn && nIn) {
    if (prev.startCol !== next.startCol || prev.endCol !== next.endCol) return true
    if ((rowIndex === prev.startRow) !== (rowIndex === next.startRow)) return true
    if ((rowIndex === prev.endRow) !== (rowIndex === next.endRow)) return true
    const pMulti = prev.startRow !== prev.endRow || prev.startCol !== prev.endCol
    const nMulti = next.startRow !== next.endRow || next.startCol !== next.endCol
    if (pMulti !== nMulti) return true
    const pFull = prev.startCol === 0 && prev.endCol === colCount - 1
    const nFull = next.startCol === 0 && next.endCol === colCount - 1
    if (pFull !== nFull) return true
  }

  if (prev && next && pAnchor && nAnchor && prev.anchorCol !== next.anchorCol) return true

  return false
}

/** Re-renders a row only for its own data, its slice of the selection, or a handler identity. */
function dataRowPropsAreEqual(prev: DataRowProps, next: DataRowProps): boolean {
  if (
    prev.row !== next.row ||
    prev.columns !== next.columns ||
    prev.workspaceId !== next.workspaceId ||
    prev.timezoneStatus !== next.timezoneStatus ||
    prev.rowIndex !== next.rowIndex ||
    prev.isFirstRow !== next.isFirstRow ||
    prev.editingColumnName !== next.editingColumnName ||
    prev.editorsReadOnly !== next.editorsReadOnly ||
    prev.pendingCellValue !== next.pendingCellValue ||
    prev.onClick !== next.onClick ||
    prev.onDoubleClick !== next.onDoubleClick ||
    prev.onSave !== next.onSave ||
    prev.onCancel !== next.onCancel ||
    prev.onContextMenu !== next.onContextMenu ||
    prev.onCellMouseDown !== next.onCellMouseDown ||
    prev.onCellMouseEnter !== next.onCellMouseEnter ||
    prev.isRowChecked !== next.isRowChecked ||
    prev.onRowToggle !== next.onRowToggle ||
    prev.onRowMouseDown !== next.onRowMouseDown ||
    prev.onRowMouseEnter !== next.onRowMouseEnter ||
    prev.runningCount !== next.runningCount ||
    prev.hasWorkflowColumns !== next.hasWorkflowColumns ||
    prev.numRegionWidth !== next.numRegionWidth ||
    prev.onStopRow !== next.onStopRow ||
    prev.onRunRow !== next.onRunRow ||
    prev.workflowGroups !== next.workflowGroups ||
    prev.activeDispatches !== next.activeDispatches ||
    prev.pinnedOffsets !== next.pinnedOffsets ||
    prev.lastPinnedColKey !== next.lastPinnedColKey ||
    prev.findMatchColumns !== next.findMatchColumns
  ) {
    return false
  }
  if (
    (prev.editingColumnName !== null || next.editingColumnName !== null) &&
    prev.initialCharacter !== next.initialCharacter
  ) {
    return false
  }

  return !cellRangeRowChanged(
    prev.rowIndex,
    prev.columns.length,
    prev.normalizedSelection,
    next.normalizedSelection
  )
}

/** One table row: the row-number gutter (checkbox on hover, run/stop on workflow tables) and its cells. */
export const DataRow = memo(function DataRow({
  row,
  columns,
  workspaceId,
  timezoneStatus,
  rowIndex,
  isFirstRow,
  editingColumnName,
  initialCharacter,
  editorsReadOnly,
  pendingCellValue,
  normalizedSelection,
  isRowChecked,
  onClick,
  onDoubleClick,
  onSave,
  onCancel,
  onContextMenu,
  onCellMouseDown,
  onCellMouseEnter,
  onRowToggle,
  onRowMouseDown,
  onRowMouseEnter,
  runningCount,
  hasWorkflowColumns,
  numRegionWidth,
  onStopRow,
  onRunRow,
  workflowGroups,
  activeDispatches,
  pinnedOffsets,
  lastPinnedColKey,
  findMatchColumns,
}: DataRowProps) {
  const touchedCellRef = useRef<{ columnKey: string; selected: boolean } | null>(null)
  const sel = normalizedSelection
  const groupById = useMemo(
    () => new Map(workflowGroups.map((group) => [group.id, group])),
    [workflowGroups]
  )
  /**
   * "Waiting on …" labels by group id, set when a dependency is unmet for this row. Computed once
   * per render so every cell in a group shares one array.
   */
  const waitingByGroupId = useMemo(() => {
    if (workflowGroups.length === 0) return null
    const nameByColumnId = new Map(columns.map((c) => [c.key, c.name]))
    const map = new Map<string, string[]>()
    for (const group of workflowGroups) {
      // An auto-run-off group never fires from the scheduler, so there is nothing to wait on.
      if (group.autoRun === false) continue
      const unmet = getUnmetGroupDeps(group, row)
      if (unmet.columns.length === 0) continue
      map.set(
        group.id,
        unmet.columns.map((id) => nameByColumnId.get(id) ?? id)
      )
    }
    return map
  }, [workflowGroups, row, columns])
  const isMultiCell = sel !== null && (sel.startRow !== sel.endRow || sel.startCol !== sel.endCol)
  /**
   * The selection's left edge at column 0 is drawn inside the sticky gutter, over its own border,
   * so the sticky cell never paints over it and the two lines never double up.
   */
  const rowInRange = sel !== null && rowIndex >= sel.startRow && rowIndex <= sel.endRow
  const isLeftEdgeSelected =
    isRowChecked || (isMultiCell && rowInRange && sel !== null && sel.startCol === 0)
  const runLabel = runningCount > 0 ? `Stop ${runningCount} running` : 'Run row'

  return (
    <tr onContextMenu={(e) => onContextMenu(e, row)}>
      <td className={styles.gutter} onMouseEnter={() => onRowMouseEnter(rowIndex)}>
        {isLeftEdgeSelected && (
          <div className={styles.gutterEdge} data-first-row={isFirstRow || undefined} />
        )}
        <div className={styles.gutterInner}>
          <div
            role='checkbox'
            tabIndex={0}
            aria-checked={isRowChecked}
            aria-label={`Select row ${rowIndex + 1}`}
            className={styles.rowSelect}
            data-checked={isRowChecked || undefined}
            ref={inlineStyle('inline-size', `${numRegionWidth}px`)}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              onRowMouseDown(rowIndex, e.shiftKey)
            }}
            onKeyDown={(event) => {
              if (event.key !== ' ' && event.key !== 'Enter') return
              event.preventDefault()
              onRowToggle(rowIndex, event.shiftKey)
            }}
          >
            <span className={styles.rowNumber} data-type='T050'>
              {rowIndex + 1}
            </span>
            <span className={styles.rowCheck} inert aria-hidden='true'>
              <Checkbox label={`Select row ${rowIndex + 1}`} labelHidden checked={isRowChecked} />
            </span>
          </div>
          {hasWorkflowColumns && (
            <IconButton
              label={runLabel}
              icon={runningCount > 0 ? 'I035' : 'play'}
              size='inline'
              tooltip
              onClick={() => {
                if (runningCount > 0) onStopRow(row.id)
                else onRunRow(row.id)
              }}
            />
          )}
        </div>
      </td>
      {columns.map((column, colIndex) => {
        const inRange =
          sel !== null &&
          rowIndex >= sel.startRow &&
          rowIndex <= sel.endRow &&
          colIndex >= sel.startCol &&
          colIndex <= sel.endCol
        const isAnchor = sel !== null && rowIndex === sel.anchorRow && colIndex === sel.anchorCol
        const isEditing = editingColumnName === column.key
        const isHighlighted = inRange || isRowChecked
        const isFindMatch = findMatchColumns?.has(column.key)

        const isTopEdge = sel && inRange ? rowIndex === sel.startRow : isRowChecked
        const isBottomEdge = sel && inRange ? rowIndex === sel.endRow : isRowChecked
        const isLeftEdge = sel && inRange ? colIndex === sel.startCol : colIndex === 0
        const isRightEdge =
          sel && inRange ? colIndex === sel.endCol : colIndex === columns.length - 1

        const pinnedLeft = pinnedOffsets?.get(column.key)
        /**
         * A cell frozen in the sticky left zone. `data-pinned` also tells overlays measured off
         * these cells (the remote selections) a frozen cell from one scrolled behind the zone.
         */
        const isPinnedCell = pinnedLeft !== undefined
        const group = column.workflowGroupId ? groupById.get(column.workflowGroupId) : undefined

        return (
          <td
            key={column.key}
            data-row={rowIndex}
            data-row-id={row.id}
            data-col={colIndex}
            data-pinned={isPinnedCell ? '' : undefined}
            data-pinned-edge={column.key === lastPinnedColKey || undefined}
            data-decorated={isHighlighted || isAnchor || isEditing || isFindMatch || undefined}
            className={styles.cell}
            ref={inlineStyle('left', isPinnedCell ? `${pinnedLeft}px` : null)}
            onPointerDown={(event) => {
              touchedCellRef.current =
                event.pointerType === 'touch'
                  ? { columnKey: column.key, selected: isAnchor && !isMultiCell }
                  : null
            }}
            onPointerCancel={() => {
              touchedCellRef.current = null
            }}
            onMouseDown={(e) => {
              if (e.button !== 0 || isEditing) return
              onCellMouseDown(rowIndex, colIndex, e.shiftKey)
            }}
            onMouseEnter={() => onCellMouseEnter(rowIndex, colIndex)}
            onClick={(e) => {
              const touchedCell = touchedCellRef.current
              touchedCellRef.current = null
              const toggleBoolean =
                !e.shiftKey &&
                e.target instanceof Element &&
                Boolean(e.target.closest('[data-boolean-cell-toggle]'))
              onClick(row.id, column.key, { toggleBoolean })
              // A tap on the already-selected cell edits it, as a double-click does with a mouse.
              if (
                touchedCell?.columnKey === column.key &&
                touchedCell.selected &&
                !isEditing &&
                !toggleBoolean
              ) {
                onDoubleClick(row.id, column.key, column.key)
              }
            }}
            onDoubleClick={() => onDoubleClick(row.id, column.key, column.key)}
          >
            {isFindMatch && (
              <div
                className={styles.findMatch}
                data-col-start={colIndex === 0 || undefined}
                data-first-row={isFirstRow || undefined}
              />
            )}
            {isHighlighted && (isMultiCell || isRowChecked) && (
              <div
                className={styles.rangeTint}
                data-col-start={colIndex === 0 || undefined}
                data-first-row={(isFirstRow && isTopEdge) || undefined}
                data-top={isTopEdge || undefined}
                data-bottom={isBottomEdge || undefined}
                data-left={(isLeftEdge && colIndex !== 0) || undefined}
                data-right={isRightEdge || undefined}
              />
            )}
            {isAnchor && (
              <div
                className={styles.anchorOutline}
                data-col-start={colIndex === 0 || undefined}
                data-first-row={isFirstRow || undefined}
              />
            )}
            <div className={styles.cellContent} data-type='T060'>
              <CellContent
                workspaceId={workspaceId}
                timezoneStatus={timezoneStatus}
                value={
                  pendingCellValue && column.key in pendingCellValue
                    ? pendingCellValue[column.key]
                    : row.data[column.key]
                }
                exec={resolveCellExec(row, group, activeDispatches)}
                column={column}
                isEditing={isEditing}
                initialCharacter={isEditing ? initialCharacter : undefined}
                readOnly={editorsReadOnly}
                onSave={(value, reason) => onSave(row.id, column.key, value, reason)}
                onCancel={onCancel}
                waitingOnLabels={
                  column.workflowGroupId
                    ? (waitingByGroupId?.get(column.workflowGroupId) ?? undefined)
                    : undefined
                }
                isEnrichmentOutput={group?.type === 'enrichment'}
              />
            </div>
          </td>
        )
      })}
    </tr>
  )
}, dataRowPropsAreEqual)
