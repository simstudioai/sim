'use client'

import { memo } from 'react'
import { Button } from '@/components/emcn'
import { Loader, Square } from '@/components/emcn/icons'

interface RunStatusControlProps {
  running: number
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
  onStopAll,
  isStopping,
}: RunStatusControlProps) {
  return (
    <div className='flex items-center gap-1.5'>
      <div className='flex items-center gap-1.5 px-1 text-[var(--text-tertiary)] text-caption'>
        <Loader animate className='h-[14px] w-[14px] shrink-0' />
        <span className='tabular-nums'>{running}</span>
        <span>running</span>
      </div>
      <Button
        variant='subtle'
        className='px-2 py-1 text-caption'
        onClick={onStopAll}
        disabled={isStopping}
      >
        <Square className='mr-1.5 h-[14px] w-[14px]' />
        Stop all
      </Button>
    </div>
  )
})
