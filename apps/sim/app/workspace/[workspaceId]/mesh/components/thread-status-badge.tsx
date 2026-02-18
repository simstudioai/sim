'use client'

import { cn } from '@/lib/core/utils/cn'

interface ThreadStatusBadgeProps {
  status: 'active' | 'completed' | 'failed'
}

const STATUS_CONFIG = {
  active: {
    label: 'Active',
    dot: 'bg-green-500',
    text: 'text-green-700 dark:text-green-300',
    bg: 'bg-green-50 dark:bg-green-900/20',
  },
  completed: {
    label: 'Done',
    dot: 'bg-[var(--text-tertiary)]',
    text: 'text-[var(--text-secondary)]',
    bg: 'bg-[var(--surface-3)]',
  },
  failed: {
    label: 'Failed',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-50 dark:bg-red-900/20',
  },
} as const

/**
 * Status badge for a mesh thread showing active/completed/failed state.
 */
export function ThreadStatusBadge({ status }: ThreadStatusBadgeProps) {
  const config = STATUS_CONFIG[status]

  return (
    <div
      className={cn(
        'inline-flex items-center gap-[5px] rounded-[4px] px-[6px] py-[2px]',
        config.bg
      )}
    >
      <div className={cn('h-[6px] w-[6px] rounded-full', config.dot)} />
      <span className={cn('font-medium text-[11px]', config.text)}>{config.label}</span>
    </div>
  )
}
