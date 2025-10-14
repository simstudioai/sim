'use client'

import { memo } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ContextUsagePillProps {
  percentage: number
  className?: string
  onCreateNewChat?: () => void
}

export const ContextUsagePill = memo(
  ({ percentage, className, onCreateNewChat }: ContextUsagePillProps) => {
    // Don't render if invalid (but DO render if 0 or very small)
    if (percentage === null || percentage === undefined || Number.isNaN(percentage)) return null

    const isHighUsage = percentage >= 75

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
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px] tabular-nums transition-colors',
          getColorClass(),
          isHighUsage && 'border border-red-500/50',
          className
        )}
        title={`Context used in this chat: ${percentage.toFixed(2)}%`}
      >
        <span>{formattedPercentage}%</span>
        {isHighUsage && onCreateNewChat && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCreateNewChat()
            }}
            className='inline-flex items-center justify-center transition-opacity hover:opacity-70'
            title='Recommended: Start a new chat for better quality'
            type='button'
          >
            <Plus className='h-3 w-3' />
          </button>
        )}
      </div>
    )
  }
)

ContextUsagePill.displayName = 'ContextUsagePill'
