import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import {
  ArrowDown,
  ArrowUp,
  Duplicate,
  Eye,
  Pencil,
  PlayOutline,
  RefreshCw,
  Square,
  Trash,
} from '@sim/emcn/icons'
import type { ContextMenuState } from '../../types'

interface ContextMenuProps {
  contextMenu: ContextMenuState
  onClose: () => void
  onEditCell: () => void
  onDelete: () => void
  onInsertAbove: () => void
  onInsertBelow: () => void
  onDuplicate: () => void
  onViewExecution?: () => void
  canViewExecution?: boolean
  canEditCell?: boolean
  selectedRowCount?: number
  /** Fires every workflow group on the row(s), skipping already-completed
   *  cells. Mirrors the action bar's Play. */
  onRunWorkflows?: () => void
  /** Re-runs every workflow group on the row(s), including already-completed
   *  cells. Mirrors the action bar's Refresh. */
  onRefreshWorkflows?: () => void
  /** Cancels every running/queued execution on the row(s) the context menu is acting on. */
  onStopWorkflows?: () => void
  /** Total running/queued executions across the row(s) under the context menu. Drives the Stop label and visibility. */
  runningInSelectionCount?: number
  /** Whether the table has any workflow columns; gates the run-workflows item. */
  hasWorkflowColumns?: boolean
  /** True when the menu was opened on a workflow-output cell, so Run / Re-run
   *  act on that cell's group only (the cascade handles dependents). Switches
   *  the labels from row-wide ("all cells") to cell-scoped ("cell"). */
  workflowCellScoped?: boolean
  disableEdit?: boolean
  disableInsert?: boolean
  /**
   * Duplicate is a one-shot insert carrying the copied row's data, so it needs
   * only the insert lock — unlike the blank-row inserts above it, which also
   * need the update lock to be fillable.
   */
  disableDuplicate?: boolean
  disableDelete?: boolean
}

export function ContextMenu({
  contextMenu,
  onClose,
  onEditCell,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onDuplicate,
  onViewExecution,
  canViewExecution = false,
  canEditCell = true,
  selectedRowCount = 1,
  onRunWorkflows,
  onRefreshWorkflows,
  onStopWorkflows,
  runningInSelectionCount = 0,
  hasWorkflowColumns = false,
  workflowCellScoped = false,
  disableEdit = false,
  disableInsert = false,
  disableDuplicate = false,
  disableDelete = false,
}: ContextMenuProps) {
  const count = selectedRowCount.toLocaleString()
  const deleteLabel = selectedRowCount > 1 ? `Delete ${count} rows` : 'Delete row'
  const runLabel = workflowCellScoped
    ? selectedRowCount > 1
      ? `Run cell on ${count} rows`
      : 'Run cell'
    : selectedRowCount > 1
      ? `Run empty or failed cells on ${count} rows`
      : 'Run empty or failed cells'
  const refreshLabel = workflowCellScoped
    ? selectedRowCount > 1
      ? `Re-run cell on ${count} rows`
      : 'Re-run cell'
    : selectedRowCount > 1
      ? `Re-run all cells on ${count} rows`
      : 'Re-run all cells'
  const stopLabel =
    runningInSelectionCount === 1
      ? 'Stop running workflow'
      : `Stop ${runningInSelectionCount} running workflows`

  return (
    <DropdownMenu
      open={contextMenu.isOpen}
      onOpenChange={(open) => !open && onClose()}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${contextMenu.position.x}px`,
            top: `${contextMenu.position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
          tabIndex={-1}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {contextMenu.columnName && canEditCell && (
          <DropdownMenuItem disabled={disableEdit} onSelect={onEditCell}>
            <Pencil />
            Edit cell
          </DropdownMenuItem>
        )}
        {canViewExecution && onViewExecution && (
          <DropdownMenuItem onSelect={onViewExecution}>
            <Eye />
            View execution
          </DropdownMenuItem>
        )}
        {/* Not gated on `disableEdit`: these write only workflow-output columns,
            which the update lock exempts, and Stop is a cancel rather than a
            write. Their handlers are already withheld without edit permission. */}
        {hasWorkflowColumns && onRunWorkflows && (
          <DropdownMenuItem onSelect={onRunWorkflows}>
            <PlayOutline />
            {runLabel}
          </DropdownMenuItem>
        )}
        {hasWorkflowColumns && onRefreshWorkflows && (
          <DropdownMenuItem onSelect={onRefreshWorkflows}>
            <RefreshCw />
            {refreshLabel}
          </DropdownMenuItem>
        )}
        {hasWorkflowColumns && onStopWorkflows && runningInSelectionCount > 0 && (
          <DropdownMenuItem onSelect={onStopWorkflows}>
            <Square className='size-[14px] text-[var(--text-icon)]' />
            {stopLabel}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={disableInsert} onSelect={onInsertAbove}>
          <ArrowUp />
          Insert row above
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disableInsert} onSelect={onInsertBelow}>
          <ArrowDown />
          Insert row below
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disableDuplicate || selectedRowCount > 1}
          onSelect={onDuplicate}
        >
          <Duplicate />
          Duplicate row
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
          <Trash />
          {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
