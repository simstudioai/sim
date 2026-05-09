'use client'

import React from 'react'
import { Button, Checkbox } from '@/components/emcn'
import { PlayOutline, Square } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { TableRow as TableRowType, WorkflowGroup } from '@/lib/table'
import { getUnmetGroupDeps } from '@/lib/table/deps'
import type { SaveReason } from '../../types'
import { CellContent } from './cells'
import {
  CELL,
  CELL_CHECKBOX,
  CELL_CONTENT,
  SELECTION_OVERLAY,
  SELECTION_TINT_BG,
} from './constants'
import type { DisplayColumn } from './types'
import { type NormalizedSelection, readExecution } from './utils'

export interface DataRowProps {
  row: TableRowType
  columns: DisplayColumn[]
  rowIndex: number
  isFirstRow: boolean
  editingColumnName: string | null
  initialCharacter: string | null
  pendingCellValue: Record<string, unknown> | null
  normalizedSelection: NormalizedSelection | null
  onClick: (rowId: string, columnName: string, options?: { toggleBoolean?: boolean }) => void
  onDoubleClick: (rowId: string, columnName: string, columnKey: string) => void
  onSave: (rowId: string, columnName: string, value: unknown, reason: SaveReason) => void
  onCancel: () => void
  onContextMenu: (e: React.MouseEvent, row: TableRowType) => void
  onCellMouseDown: (rowIndex: number, colIndex: number, shiftKey: boolean) => void
  onCellMouseEnter: (rowIndex: number, colIndex: number) => void
  isRowChecked: boolean
  onRowToggle: (rowIndex: number, shiftKey: boolean) => void
  /** Number of workflow cells in this row currently in a running/queued state. */
  runningCount: number
  /** Whether the table has at least one workflow column — controls whether a run/stop icon is rendered. */
  hasWorkflowColumns: boolean
  /** Width of the row-number inner div in px, derived from the table's maxRows digit count. */
  numDivWidth: number
  onStopRow: (rowId: string) => void
  onRunRow: (rowId: string) => void
  /**
   * The table's workflow groups, used to compute per-row "Waiting on …" labels
   * for empty workflow-output cells whose group has unmet dependencies.
   */
  workflowGroups: WorkflowGroup[]
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

  if (pIn && nIn) {
    if (prev!.startCol !== next!.startCol || prev!.endCol !== next!.endCol) return true
    if ((rowIndex === prev!.startRow) !== (rowIndex === next!.startRow)) return true
    if ((rowIndex === prev!.endRow) !== (rowIndex === next!.endRow)) return true
    const pMulti = prev!.startRow !== prev!.endRow || prev!.startCol !== prev!.endCol
    const nMulti = next!.startRow !== next!.endRow || next!.startCol !== next!.endCol
    if (pMulti !== nMulti) return true
    const pFull = prev!.startCol === 0 && prev!.endCol === colCount - 1
    const nFull = next!.startCol === 0 && next!.endCol === colCount - 1
    if (pFull !== nFull) return true
  }

  if (pAnchor && nAnchor && prev!.anchorCol !== next!.anchorCol) return true

  return false
}

function dataRowPropsAreEqual(prev: DataRowProps, next: DataRowProps): boolean {
  if (
    prev.row !== next.row ||
    prev.columns !== next.columns ||
    prev.rowIndex !== next.rowIndex ||
    prev.isFirstRow !== next.isFirstRow ||
    prev.editingColumnName !== next.editingColumnName ||
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
    prev.runningCount !== next.runningCount ||
    prev.hasWorkflowColumns !== next.hasWorkflowColumns ||
    prev.numDivWidth !== next.numDivWidth ||
    prev.onStopRow !== next.onStopRow ||
    prev.onRunRow !== next.onRunRow ||
    prev.workflowGroups !== next.workflowGroups
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

export const DataRow = React.memo(function DataRow({
  row,
  columns,
  rowIndex,
  isFirstRow,
  editingColumnName,
  initialCharacter,
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
  runningCount,
  hasWorkflowColumns,
  numDivWidth,
  onStopRow,
  onRunRow,
  workflowGroups,
}: DataRowProps) {
  const sel = normalizedSelection
  /**
   * Per-row "Waiting on …" labels keyed by group id. A group has labels iff
   * at least one of its dependencies is unmet for this row — drives the
   * "Waiting" pill rendered by `CellContent` for empty workflow-output cells.
   * Computed once per render rather than per cell so all cells in a group
   * share the same array reference.
   */
  const waitingByGroupId = React.useMemo(() => {
    if (workflowGroups.length === 0) return null
    const map = new Map<string, string[]>()
    for (const group of workflowGroups) {
      // autoRun=false groups never fire from the scheduler — there's nothing
      // to wait on. The cell stays empty until the user clicks Run manually.
      if (group.autoRun === false) continue
      const unmet = getUnmetGroupDeps(group, row)
      if (unmet.columns.length === 0) continue
      map.set(group.id, unmet.columns)
    }
    return map
  }, [workflowGroups, row])
  const isMultiCell = sel !== null && (sel.startRow !== sel.endRow || sel.startCol !== sel.endCol)
  const isRowSelected = isRowChecked

  return (
    <tr onContextMenu={(e) => onContextMenu(e, row)}>
      <td className={cn(CELL_CHECKBOX, 'cursor-pointer')}>
        <div
          className={cn(
            'flex items-center gap-1',
            hasWorkflowColumns ? 'justify-between' : 'justify-center'
          )}
        >
          <div
            className='group/checkbox flex h-[20px] shrink-0 items-center justify-center'
            style={{ width: numDivWidth }}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              onRowToggle(rowIndex, e.shiftKey)
            }}
          >
            <span
              className={cn(
                'text-center text-[var(--text-tertiary)] text-xs tabular-nums',
                isRowSelected ? 'hidden' : 'block group-hover/checkbox:hidden'
              )}
            >
              {rowIndex + 1}
            </span>
            <div
              className={cn(
                'items-center justify-end',
                isRowSelected ? 'flex' : 'hidden group-hover/checkbox:flex'
              )}
            >
              <Checkbox size='sm' checked={isRowSelected} className='pointer-events-none' />
            </div>
          </div>
          {hasWorkflowColumns && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              aria-label={runningCount > 0 ? `Stop ${runningCount} running` : 'Run row'}
              title={runningCount > 0 ? `Stop ${runningCount} running` : 'Run row'}
              // mr-px keeps the hover bg off the cell's right border — without
              // it the rounded-rect background paints over the divider line
              // while the button is hovered.
              className='mr-px h-[20px] w-[20px] shrink-0 px-0 py-0 text-[var(--text-primary)] hover-hover:bg-[var(--surface-2)]'
              onClick={() => {
                if (runningCount > 0) {
                  onStopRow(row.id)
                } else {
                  onRunRow(row.id)
                }
              }}
            >
              {runningCount > 0 ? (
                <Square className='h-[12px] w-[12px]' />
              ) : (
                <PlayOutline className='h-[12px] w-[12px]' />
              )}
            </Button>
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
        const isEditing = editingColumnName === column.name
        const isHighlighted = inRange || isRowChecked

        const isTopEdge = inRange ? rowIndex === sel!.startRow : isRowChecked
        const isBottomEdge = inRange ? rowIndex === sel!.endRow : isRowChecked
        const isLeftEdge = inRange ? colIndex === sel!.startCol : colIndex === 0
        const isRightEdge = inRange ? colIndex === sel!.endCol : colIndex === columns.length - 1

        return (
          <td
            key={column.key}
            data-row={rowIndex}
            data-row-id={row.id}
            data-col={colIndex}
            className={cn(CELL, (isHighlighted || isAnchor || isEditing) && 'relative')}
            onMouseDown={(e) => {
              if (e.button !== 0 || isEditing) return
              onCellMouseDown(rowIndex, colIndex, e.shiftKey)
            }}
            onMouseEnter={() => onCellMouseEnter(rowIndex, colIndex)}
            onClick={(e) =>
              onClick(row.id, column.name, {
                toggleBoolean:
                  !e.shiftKey &&
                  Boolean((e.target as HTMLElement).closest('[data-boolean-cell-toggle]')),
              })
            }
            onDoubleClick={() => onDoubleClick(row.id, column.name, column.key)}
          >
            {isHighlighted && (isMultiCell || isRowChecked) && (
              <div
                className={cn(
                  '-top-px -right-px -bottom-px pointer-events-none absolute z-[4]',
                  colIndex === 0 ? 'left-0' : '-left-px',
                  SELECTION_TINT_BG,
                  isFirstRow && isTopEdge && 'top-0',
                  isTopEdge && 'border-t border-t-[var(--selection)]',
                  isBottomEdge && 'border-b border-b-[var(--selection)]',
                  isLeftEdge && 'border-l border-l-[var(--selection)]',
                  isRightEdge && 'border-r border-r-[var(--selection)]'
                )}
              />
            )}
            {isAnchor && (
              <div
                className={cn(
                  SELECTION_OVERLAY,
                  colIndex === 0 ? 'left-0' : '-left-px',
                  isFirstRow && 'top-0'
                )}
              />
            )}
            <div className={CELL_CONTENT}>
              <CellContent
                value={
                  pendingCellValue && column.name in pendingCellValue
                    ? pendingCellValue[column.name]
                    : row.data[column.name]
                }
                exec={readExecution(row, column.workflowGroupId)}
                column={column}
                isEditing={isEditing}
                initialCharacter={isEditing ? initialCharacter : undefined}
                onSave={(value, reason) => onSave(row.id, column.name, value, reason)}
                onCancel={onCancel}
                waitingOnLabels={
                  column.workflowGroupId
                    ? (waitingByGroupId?.get(column.workflowGroupId) ?? undefined)
                    : undefined
                }
              />
            </div>
          </td>
        )
      })}
    </tr>
  )
}, dataRowPropsAreEqual)
