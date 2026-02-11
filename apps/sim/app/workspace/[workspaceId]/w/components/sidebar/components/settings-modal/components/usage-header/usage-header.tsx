'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/emcn'
import { getFilledPillColor, USAGE_PILL_COLORS, USAGE_THRESHOLDS } from '@/lib/billing/client'

const PILL_COUNT = 5

interface UsageHeaderProps {
  title: string
  showBadge?: boolean
  badgeText?: string
  badgeVariant?: 'blue-secondary' | 'red'
  onBadgeClick?: () => void
  rightContent?: ReactNode
  current: number
  limit: number
  seatsText?: string
  isBlocked?: boolean
  progressValue?: number
}

/**
 * Displays usage header with plan info and usage pills.
 */
export function UsageHeader({
  title,
  showBadge = false,
  badgeText,
  badgeVariant = 'blue-secondary',
  onBadgeClick,
  rightContent,
  current,
  limit,
  seatsText,
  isBlocked,
  progressValue,
}: UsageHeaderProps) {
  const progress = progressValue ?? (limit > 0 ? Math.min((current / limit) * 100, 100) : 0)
  const filledPillsCount = Math.ceil((progress / 100) * PILL_COUNT)

  const isCritical = isBlocked || progress >= USAGE_THRESHOLDS.CRITICAL
  const isWarning = !isCritical && progress >= USAGE_THRESHOLDS.WARNING
  const filledColor = getFilledPillColor(isCritical, isWarning)

  return (
    <div className='flex flex-col gap-[12px]'>
      {/* Main row: left = plan + usage, right = badge + pills */}
      <div className='flex items-center justify-between'>
        {/* Left side: plan name and usage */}
        <div className='flex flex-col gap-[4px]'>
          <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
            {title}
            {seatsText && (
              <span className='ml-[6px] text-[var(--text-tertiary)]'>({seatsText})</span>
            )}
          </span>
          <div className='flex items-center gap-[4px]'>
            {isBlocked ? (
              <span className='font-medium text-[14px] text-[var(--text-error)]'>
                Payment failed
              </span>
            ) : (
              <>
                <span className='font-medium text-[14px] text-[var(--text-primary)] tabular-nums'>
                  ${current.toFixed(2)}
                </span>
                <span className='font-medium text-[14px] text-[var(--text-primary)]'>/</span>
                {rightContent ?? (
                  <span className='font-medium text-[14px] text-[var(--text-primary)] tabular-nums'>
                    ${limit.toFixed(2)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right side: badge and pills */}
        <div className='flex flex-col items-end gap-[8px]'>
          {showBadge && badgeText && (
            <Badge
              variant={badgeVariant}
              onClick={onBadgeClick}
              className={onBadgeClick ? 'cursor-pointer' : 'cursor-default'}
            >
              {badgeText}
            </Badge>
          )}
          {/* Pills row */}
          <div className='flex w-[100px] items-center gap-[4px]'>
            {Array.from({ length: PILL_COUNT }).map((_, i) => {
              const isFilled = i < filledPillsCount
              return (
                <div
                  key={i}
                  className='h-[6px] flex-1 rounded-[2px]'
                  style={{
                    backgroundColor: isFilled ? filledColor : USAGE_PILL_COLORS.UNFILLED,
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
