'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Button, Tooltip } from '@/components/emcn'
import { Eye, PlayOutline, RefreshCw, Square } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

interface TableActionBarProps {
  /** Number of (row × group) cells the run/stop buttons would target. Drives
   *  the bar's leading label ("N cells"). */
  selectedCellCount: number
  /** Total running/queued workflow cells in the selection. Drives Stop. */
  runningCount: number
  /** Whether the table has any workflow columns. The bar hides entirely when
   *  there are none — Run/Stop have nothing to act on. */
  hasWorkflowColumns: boolean
  /** Show the Play (incomplete-mode) button — true when any selected cell is
   *  empty / errored / cancelled. */
  showPlay: boolean
  /** Show the Refresh (all-mode) button — true when any selected cell is
   *  already completed. */
  showRefresh: boolean
  /** Smart run: fire workflows only on cells that are empty / errored /
   *  cancelled. Maps to server `runMode: 'incomplete'`. */
  onPlay: () => void
  /** Forceful re-run: fire workflows on every selected cell, including
   *  completed ones. Maps to server `runMode: 'all'`. */
  onRefresh: () => void
  /** Cancel running/queued cells in the selection. */
  onStopWorkflows: () => void
  /** When the user has highlighted exactly one workflow cell (or N adjacent
   *  cells in the same row + group), surface a "View execution" affordance
   *  alongside the run buttons. Omit when no single-execution view applies. */
  onViewExecution?: () => void
  /** Disables actions while a bulk mutation is in flight. */
  isLoading?: boolean
  /** Additional className for the floating wrapper — used to lift the bar
   *  above bottom-anchored UI like a pagination row. */
  className?: string
}

/**
 * Floating action bar shown at the bottom of the table when one or more
 * workflow cells are highlighted. Play / Refresh visibility is data-driven:
 * Play appears when there's anything empty/failed in the selection; Refresh
 * appears when there's anything already completed; both when the selection is
 * mixed.
 *
 * Rendered with `position: absolute` inside the table's container (not
 * `fixed`) so it scopes to the table's bounds — important for embedded mode,
 * where the table sits inside a panel and a fixed-positioned bar would land
 * centered on the whole viewport instead of the panel.
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
  isLoading = false,
  className,
}: TableActionBarProps) {
  const visible =
    hasWorkflowColumns &&
    selectedCellCount > 0 &&
    (showPlay || showRefresh || runningCount > 0 || Boolean(onViewExecution))
  const stopLabel =
    runningCount === 1 ? 'Stop running workflow' : `Stop ${runningCount} running workflows`
  const playLabel =
    selectedCellCount === 1 ? 'Run cell' : `Run ${selectedCellCount} empty or failed cells`
  const refreshLabel = selectedCellCount === 1 ? 'Re-run cell' : `Re-run ${selectedCellCount} cells`

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
              {selectedCellCount === 1
                ? 'Selected 1 workflow cell'
                : `Selected ${selectedCellCount} workflow cells`}
            </span>

            <div className='flex items-center gap-[5px]'>
              {showPlay && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      onClick={onPlay}
                      disabled={isLoading}
                      className='hover-hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                      aria-label={playLabel}
                    >
                      <PlayOutline className='h-[12px] w-[12px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>{playLabel}</Tooltip.Content>
                </Tooltip.Root>
              )}

              {showRefresh && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      onClick={onRefresh}
                      disabled={isLoading}
                      className='hover-hover:!text-[var(--text-inverse)] h-[28px] w-[28px] rounded-lg bg-[var(--surface-5)] p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
                      aria-label={refreshLabel}
                    >
                      <RefreshCw className='h-[12px] w-[12px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>{refreshLabel}</Tooltip.Content>
                </Tooltip.Root>
              )}

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

              {onViewExecution && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      onClick={onViewExecution}
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
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
