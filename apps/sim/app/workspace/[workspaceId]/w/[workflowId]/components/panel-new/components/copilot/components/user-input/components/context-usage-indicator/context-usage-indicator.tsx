'use client'

import { useMemo } from 'react'
import { Tooltip } from '@/components/emcn'

interface ContextUsageIndicatorProps {
  /** Usage percentage (0-100) */
  percentage: number
  /** Size of the indicator in pixels */
  size?: number
  /** Stroke width in pixels */
  strokeWidth?: number
}

/**
 * Circular context usage indicator showing percentage of context window used.
 * Displays a progress ring that changes color based on usage level.
 *
 * @param props - Component props
 * @returns Rendered context usage indicator
 */
export function ContextUsageIndicator({
  percentage,
  size = 20,
  strokeWidth = 2,
}: ContextUsageIndicatorProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (percentage / 100) * circumference

  const color = useMemo(() => {
    if (percentage >= 90) return '#dc2626'
    if (percentage >= 75) return '#d97706'
    return '#6b7280'
  }, [percentage])

  const displayPercentage = useMemo(() => {
    return Math.round(percentage)
  }, [percentage])

  return (
    <Tooltip.Root delayDuration={100}>
      <Tooltip.Trigger asChild>
        <div
          className='flex cursor-pointer items-center justify-center transition-opacity hover:opacity-80'
          style={{ width: size, height: size }}
        >
          <svg width={size} height={size} className='rotate-[-90deg]'>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke='currentColor'
              strokeWidth={strokeWidth}
              fill='none'
              className='text-muted-foreground/20'
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={color}
              strokeWidth={strokeWidth}
              fill='none'
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className='transition-all duration-300 ease-in-out'
              strokeLinecap='round'
            />
          </svg>
        </div>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{displayPercentage}% context used</Tooltip.Content>
    </Tooltip.Root>
  )
}
