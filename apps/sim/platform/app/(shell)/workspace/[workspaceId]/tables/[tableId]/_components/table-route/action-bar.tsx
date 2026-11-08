'use client'

import { IconButton } from '@sim/emcn/button'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-route/table-route.module.css'

interface TableActionBarProps {
  /** Row × group cells the run and stop actions target, for the leading label. */
  selectedCellCount: number
  /** Running or queued workflow cells in the selection, which enables Stop. */
  runningCount: number
  /** The bar hides on a table without workflow columns, which gives Run nothing to act on. */
  hasWorkflowColumns: boolean
  /** Some selected cell is empty, failed or cancelled. */
  showPlay: boolean
  /** Some selected cell already completed. */
  showRefresh: boolean
  /** Runs only the empty, failed or cancelled cells. */
  onPlay: () => void
  /** Re-runs every selected cell, completed ones included. */
  onRefresh: () => void
  onStopWorkflows: () => void
  /** Present when the selection resolves to exactly one run, whose details it opens. */
  onViewExecution?: () => void
}

/**
 * Floats over the bottom of the grid while workflow cells are selected: what is selected, then Run
 * (empty or failed), Re-run (everything), Stop and View execution, in the order the row menu uses.
 */
export function TableActionBar({
  selectedCellCount,
  runningCount,
  hasWorkflowColumns,
  showPlay,
  showRefresh,
  onPlay,
  onRefresh,
  onStopWorkflows,
  onViewExecution,
}: TableActionBarProps) {
  const visible =
    hasWorkflowColumns &&
    selectedCellCount > 0 &&
    (showPlay || showRefresh || runningCount > 0 || Boolean(onViewExecution))
  if (!visible) return null
  const stopLabel =
    runningCount === 1 ? 'Stop running workflow' : `Stop ${runningCount} running workflows`
  const playLabel =
    selectedCellCount === 1 ? 'Run cell' : `Run ${selectedCellCount} empty or failed cells`
  const refreshLabel = selectedCellCount === 1 ? 'Re-run cell' : `Re-run ${selectedCellCount} cells`

  return (
    <div className={styles.actionBar}>
      <div className={styles.actionBarSurface} data-material='floating' data-elevation='menu'>
        <span className={styles.actionBarLabel} data-type='T060'>
          {selectedCellCount === 1
            ? 'Selected 1 workflow cell'
            : `Selected ${selectedCellCount} workflow cells`}
        </span>
        <span className={styles.actionBarActions}>
          {showPlay && <IconButton label={playLabel} icon='play' tooltip onClick={onPlay} />}
          {showRefresh && (
            <IconButton label={refreshLabel} icon='I065' tooltip onClick={onRefresh} />
          )}
          {runningCount > 0 && (
            <IconButton label={stopLabel} icon='I035' tooltip onClick={onStopWorkflows} />
          )}
          {onViewExecution && (
            <IconButton label='View execution' icon='eye' tooltip onClick={onViewExecution} />
          )}
        </span>
      </div>
    </div>
  )
}
