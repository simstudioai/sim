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
  Blimp,
  Duplicate,
  Eye,
  ListFilter,
  Pencil,
  PlayOutline,
  RefreshCw,
  Square,
  Trash,
} from '@sim/emcn/icons'
import type { ContextMenuState } from '../../types'

/**
 * Wider than the menu's 220px default. The row-scoped workflow labels name both
 * the action and the selected row count ("Run empty or failed cells on 2 rows"),
 * which does not fit the default width.
 */
const CONTENT_WIDTH_CLASS = 'max-w-[320px]'

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
  /**
   * Narrows the table to rows whose cell in this column reads the same as the
   * one under the cursor. Omit when the cell cannot be expressed as a filter
   * (a structured value, or an operator its column type rejects).
   */
  onFilterByCellValue?: () => void
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
  /** Adds the selected rows / cell range to Chat as a reference. Omit to hide. */
  onAddToChat?: () => void
  /**
   * True when the selection is a spreadsheet-style cell range rather than whole
   * rows, switching the label from row-scoped to cell-scoped. Mirrors
   * {@link ContextMenuProps.workflowCellScoped}.
   */
  addToChatCellScoped?: boolean
  /**
   * Rows the chip will reference. Differs from {@link ContextMenuProps.selectedRowCount}
   * because a gutter selection can extend past the loaded page and the chip
   * carries ids the server re-fetches, so the label must not promise fewer rows
   * than are actually sent. Defaults to `selectedRowCount`.
   */
  addToChatRowCount?: number
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
  onFilterByCellValue,
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
  onAddToChat,
  addToChatCellScoped = false,
  addToChatRowCount,
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
  const addToChatRows = addToChatRowCount ?? selectedRowCount
  const addToChatLabel = addToChatCellScoped
    ? 'Add cell range to Chat'
    : addToChatRows > 1
      ? `Add ${addToChatRows.toLocaleString()} rows to Chat`
      : 'Add row to Chat'

  /**
   * Whether anything renders above the sibling-creating inserts. Each term is the
   * exact render condition of its item, so the rule can never lead the menu.
   *
   * @see `.claude/rules/sim-list-ordering.md` — a rule marks a change in what the
   * action acts on.
   */
  const hasCellScopedActions =
    Boolean(onAddToChat) ||
    Boolean(contextMenu.columnName && canEditCell) ||
    Boolean(onFilterByCellValue) ||
    Boolean(hasWorkflowColumns && onRunWorkflows) ||
    Boolean(hasWorkflowColumns && onRefreshWorkflows) ||
    Boolean(hasWorkflowColumns && onStopWorkflows && runningInSelectionCount > 0) ||
    Boolean(canViewExecution && onViewExecution)

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
        className={CONTENT_WIDTH_CLASS}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {onAddToChat && (
          <DropdownMenuItem onSelect={onAddToChat}>
            <Blimp />
            {addToChatLabel}
          </DropdownMenuItem>
        )}
        {contextMenu.columnName && canEditCell && (
          <DropdownMenuItem disabled={disableEdit} onSelect={onEditCell}>
            <Pencil />
            Edit cell
          </DropdownMenuItem>
        )}
        {/* Cell-scoped like Edit cell above it, and a read action every viewer
            can take — deliberately not gated on `disableEdit`. The grid only
            supplies the handler for a cell that has a filter to offer. */}
        {onFilterByCellValue && (
          <DropdownMenuItem onSelect={onFilterByCellValue}>
            <ListFilter />
            Filter by cell value
          </DropdownMenuItem>
        )}
        {/* Run, Re-run, Stop, then View execution — the order the action bar
            presents the same four, so the user reads one sequence in both.

            Not gated on `disableEdit`: these write only workflow-output columns,
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
        {canViewExecution && onViewExecution && (
          <DropdownMenuItem onSelect={onViewExecution}>
            <Eye />
            View execution
          </DropdownMenuItem>
        )}
        {/* Stops acting on the clicked cell/row and starts creating siblings. Every
            item above is conditional, so the rule is guarded on all of them. */}
        {hasCellScopedActions && <DropdownMenuSeparator />}
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
