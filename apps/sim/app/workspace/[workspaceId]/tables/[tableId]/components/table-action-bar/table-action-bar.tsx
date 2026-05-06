'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Square } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'
import { PlayOutline, RefreshCw } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

interface TableActionBarProps {
  /** Number of rows currently selected (checkbox + multi-row range). */
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
  /** Disables actions while a bulk mutation is in flight. */
  isLoading?: boolean
  /** Additional className for the floating wrapper — used to lift the bar
   *  above bottom-anchored UI like a pagination row. */
  className?: string
}

/**
 * Floating action bar shown at the bottom of the viewport when one or more
 * rows are selected on a table that has workflow columns. Mirrors the shell
 * + interaction pattern from the knowledge-base `<ActionBar>` so the bulk-
 * action surface reads consistently across the product.
 *
 * Two run actions: **Play** is the smart default (run only on empty / failed
 * cells); **Refresh** forces a full re-run on every selected row. **Stop**
 * only appears when ≥1 selected row has a running cell.
 */
export function TableActionBar({
  selectedCount,
  runningCount,
  hasWorkflowColumns,
  onRun,
  onRerun,
  onStopWorkflows,
  isLoading = false,
  className,
}: TableActionBarProps) {
  const visible = hasWorkflowColumns && selectedCount > 0
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
          className={cn('-translate-x-1/2 fixed bottom-6 z-50 transform', className)}
          style={{ left: '50%' }}
        >
          <div className='flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'>
            <span className='px-1 text-[var(--text-secondary)] text-small'>
              {selectedCount} selected
            </span>

            <div className='flex items-center gap-[5px]'>
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
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
