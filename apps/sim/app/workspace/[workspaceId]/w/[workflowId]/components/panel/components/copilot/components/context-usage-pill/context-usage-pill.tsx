'use client'

import { memo } from 'react'
import { cn } from '@/lib/utils'

interface ContextUsagePillProps {
  percentage: number
  className?: string
}

export const ContextUsagePill = memo(({ percentage, className }: ContextUsagePillProps) => {
  // Don't render if invalid (but DO render if 0 or very small)
  if (percentage === null || percentage === undefined || Number.isNaN(percentage)) return null

  // Determine color based on percentage (similar to Cursor IDE)
  const getColorClass = () => {
    if (percentage >= 90) return 'bg-red-500/10 text-red-600 dark:text-red-400'
    if (percentage >= 75) return 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
    if (percentage >= 50) return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
    return 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
  }

  // Format: show 1 decimal for <1%, 0 decimals for >=1%
  const formattedPercentage = percentage < 1 ? percentage.toFixed(1) : percentage.toFixed(0)

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full px-2 py-0.5 font-medium text-[11px] tabular-nums transition-colors',
        getColorClass(),
        className
      )}
      title={`Context: ${percentage.toFixed(2)}%`}
    >
      {formattedPercentage}%
    </div>
  )
})

ContextUsagePill.displayName = 'ContextUsagePill'
