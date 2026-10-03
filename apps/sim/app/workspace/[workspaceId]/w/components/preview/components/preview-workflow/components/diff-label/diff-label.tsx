'use client'

import { cn } from '@sim/emcn'
import type { BlockDiffStatus } from '@/lib/workflows/comparison'

/** The word for each comparison status, shared by the canvas label and the change list badge. */
export const DIFF_LABEL: Record<BlockDiffStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
}

const DIFF_LABEL_CLASS: Record<BlockDiffStatus, string> = {
  added: 'bg-[var(--brand-accent)] text-[var(--text-inverse)]',
  modified: 'bg-[var(--warning)] text-[var(--text-inverse)]',
  removed: 'bg-[var(--surface-7)] text-[var(--text-secondary)]',
}

interface DiffStatusLabelProps {
  status: BlockDiffStatus
}

/**
 * The comparison label floating above a canvas card or container: the same
 * chrome wherever it appears so a block and a loop read as one system.
 */
export function DiffStatusLabel({ status }: DiffStatusLabelProps) {
  return (
    <div
      className={cn(
        '-top-[22px] pointer-events-none absolute left-2 z-40 rounded-sm px-1.5 py-0.5 font-medium text-xs leading-[14px]',
        DIFF_LABEL_CLASS[status]
      )}
    >
      {DIFF_LABEL[status]}
    </div>
  )
}
