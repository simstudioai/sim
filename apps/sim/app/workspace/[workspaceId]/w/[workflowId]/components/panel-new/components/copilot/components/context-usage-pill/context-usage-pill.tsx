'use client'

import { memo } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Threshold for high context usage warning (75%)
 */
const HIGH_USAGE_THRESHOLD = 75

/**
 * Color thresholds for context usage indicator
 */
const COLOR_THRESHOLDS = {
  CRITICAL: 90,
  WARNING: 75,
  MODERATE: 50,
} as const

/**
 * Props for the ContextUsagePill component
 */
interface ContextUsagePillProps {
  /** Current context usage percentage (0-100) */
  percentage: number
  /** Additional CSS classes to apply */
  className?: string
  /** Callback to create a new chat when usage is high */
  onCreateNewChat?: () => void
}

/**
 * Context usage indicator pill showing percentage of context window used
 * Displays color-coded percentage with option to start new chat when usage is high
 *
 * Color scheme:
 * - Red (≥90%): Critical usage
 * - Orange (≥75%): Warning usage
 * - Yellow (≥50%): Moderate usage
 * - Gray (<50%): Normal usage
 *
 * @param props - Component props
 * @returns Context usage pill with percentage and optional new chat button
 */
export const ContextUsagePill = memo(
  ({ percentage, className, onCreateNewChat }: ContextUsagePillProps) => {
    if (percentage === null || percentage === undefined || Number.isNaN(percentage)) {
      return null
    }

    const isHighUsage = percentage >= HIGH_USAGE_THRESHOLD

    /**
     * Determines the color class based on usage percentage
     * @returns Tailwind classes for background and text color
     */
    const getColorClass = () => {
      if (percentage >= COLOR_THRESHOLDS.CRITICAL) {
        return 'bg-red-500/10 text-red-600 dark:text-red-400'
      }
      if (percentage >= COLOR_THRESHOLDS.WARNING) {
        return 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
      }
      if (percentage >= COLOR_THRESHOLDS.MODERATE) {
        return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
      }
      return 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
    }

    /**
     * Formats percentage for display
     * Shows 1 decimal place for values <1%, 0 decimals otherwise
     */
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
