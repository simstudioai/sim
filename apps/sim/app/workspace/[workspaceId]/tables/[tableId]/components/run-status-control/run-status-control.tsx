'use client'

import { memo } from 'react'
import { Button } from '@sim/emcn'
import { Loader, Square } from '@sim/emcn/icons'

interface RunStatusControlProps {
  running: number
  /** No cell has been claimed by a worker yet — everything counted is queued
   *  or pending, so labeling it "running" would be dishonest. Renders
   *  "Queueing" without a count instead. */
  queueing: boolean
  onStopAll: () => void
  isStopping: boolean
}

/**
 * Run-status + Stop-all control rendered in the page header's leading actions
 * row when any workflow runs are active. Matches the in-cell running indicator
 * (Loader + tertiary text) for consistency.
 */
export const RunStatusControl = memo(function RunStatusControl({
  running,
  queueing,
  onStopAll,
  isStopping,
}: RunStatusControlProps) {
  return (
    <div className='flex items-center gap-1.5'>
      <div className='flex items-center gap-1.5 px-1 text-[var(--text-tertiary)] text-caption'>
        <Loader animate className='size-[14px] shrink-0' />
        {queueing ? (
          <span>Queueing</span>
        ) : (
          <>
            <span className='tabular-nums'>{running}</span>
            <span>running</span>
          </>
        )}
      </div>
      <Button
        variant='subtle'
        className='px-2 py-1 text-caption'
        onClick={onStopAll}
        disabled={isStopping}
      >
        <Square className='mr-1.5 size-[14px]' />
        {isStopping ? 'Stopping…' : 'Stop all'}
      </Button>
    </div>
  )
})
