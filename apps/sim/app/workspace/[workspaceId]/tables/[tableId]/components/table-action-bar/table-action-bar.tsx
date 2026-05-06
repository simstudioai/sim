'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Button, Tooltip } from '@/components/emcn'
import { Eye, PlayOutline, RefreshCw, Square } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

interface TableActionBarProps {
  /** Number of rows currently selected (checkbox + multi-row range). 0 in
   *  single-cell mode (use `singleCell` instead). */
  selectedCount: number
  /** Total running/queued workflow cells across the selected rows. Drives the
   *  Stop button's visibility (hidden when 0) and label. */
  runningCount: number
  /** Whether the table has any workflow columns. The bar is hidden entirely
   *  when there are none — Run/Stop have nothing to act on. */
  hasWorkflowColumns: boolean
  /** Smart run: fire workflows only on rows whose cells are empty / errored
   *  / cancelled. Skips already-completed cells. Maps to server
   *  `runMode: 'incomplete'`. The default action — what "play" should
   *  intuitively do. */
  onRun: () => void
  /** Forceful re-run: fire workflows on every selected row, including ones
   *  that already have results. Maps to server `runMode: 'all'`. */
  onRerun: () => void
  /** Cancel running/queued cells across selected rows. */
  onStopWorkflows: () => void
  /**
   * When the user has a single workflow-output cell highlighted (no row
   * selection), the bar switches to a per-cell mode showing the cell's
   * status + an Eye button to open the execution log. `null` for multi-row
   * selections.
   */
  singleCell?: {
    canViewExecution: boolean
    onViewExecution: () => void
    isRunning: boolean
    onRunCell: () => void
    onStopCell: () => void
  } | null
  /** Disables actions while a bulk mutation is in flight. */
  isLoading?: boolean
  /** Additional className for the floating wrapper — used to lift the bar
   *  above bottom-anchored UI like a pagination row. */
  className?: string
}

/**
 * Floating action bar shown at the bottom of the table when one or more rows
 * are selected, OR when a single workflow-output cell is highlighted. Mirrors
 * the shell + interaction pattern from the knowledge-base `<ActionBar>`.
 *
 * Rendered with `position: absolute` inside the table's container (not
 * `fixed`) so it scopes to the table's bounds — important for embedded mode,
 * where the table sits inside a panel and a fixed-positioned bar would land
 * centered on the whole viewport instead of the panel.
 */
export function TableActionBar({
  selectedCount,
  runningCount,
  hasWorkflowColumns,
  onRun,
  onRerun,
  onStopWorkflows,
  singleCell,
  isLoading = false,
  className,
}: TableActionBarProps) {
  const isMultiRow = selectedCount > 0
  const isSingleCell = !isMultiRow && Boolean(singleCell)
  const visible = hasWorkflowColumns && (isMultiRow || isSingleCell)
  const stopLabel =
    runningCount === 1 ? 'Stop running workflow' : `Stop ${runningCount} running workflows`
  const runLabel = 'Run workflows on empty or failed cells'
  const rerunLabel =
    selectedCount === 1 ? 'Re-run workflows on row' : `Re-run workflows on ${selectedCount} rows`

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key='table-action-bar'
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.2 }}
          className={cn(
            '-translate-x-1/2 pointer-events-none absolute bottom-6 left-1/2 z-50 transform',
            className
          )}
        >
          <div className='pointer-events-auto flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'>
            <span className='px-1 text-[var(--text-secondary)] text-small'>
              {isMultiRow ? `${selectedCount} selected` : 'Cell'}
            </span>

            <div className='flex items-center gap-[5px]'>
              {isMultiRow && (
                <>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant='ghost'
                        onClick={onRun}
                        disabled={isLoading}
                        className='hover-hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                        aria-label={runLabel}
                      >
                        <PlayOutline className='h-[12px] w-[12px]' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>{runLabel}</Tooltip.Content>
                  </Tooltip.Root>

                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant='ghost'
                        onClick={onRerun}
                        disabled={isLoading}
                        className='hover-hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                        aria-label={rerunLabel}
                      >
                        <RefreshCw className='h-[12px] w-[12px]' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>{rerunLabel}</Tooltip.Content>
                  </Tooltip.Root>

                  {runningCount > 0 && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={onStopWorkflows}
                          disabled={isLoading}
                          className='hover-hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                          aria-label={stopLabel}
                        >
                          <Square className='h-[12px] w-[12px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top'>{stopLabel}</Tooltip.Content>
                    </Tooltip.Root>
                  )}
                </>
              )}

              {isSingleCell && singleCell && (
                <>
                  {!singleCell.isRunning && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={singleCell.onRunCell}
                          disabled={isLoading}
                          className='hover-hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                          aria-label='Run cell'
                        >
                          <PlayOutline className='h-[12px] w-[12px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top'>Run cell</Tooltip.Content>
                    </Tooltip.Root>
                  )}

                  {singleCell.isRunning && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={singleCell.onStopCell}
                          disabled={isLoading}
                          className='hover-hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                          aria-label='Stop cell'
                        >
                          <Square className='h-[12px] w-[12px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top'>Stop cell</Tooltip.Content>
                    </Tooltip.Root>
                  )}

                  {singleCell.canViewExecution && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost'
                          onClick={singleCell.onViewExecution}
                          disabled={isLoading}
                          className='hover-hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                          aria-label='View execution'
                        >
                          <Eye className='h-[12px] w-[12px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top'>View execution</Tooltip.Content>
                    </Tooltip.Root>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
