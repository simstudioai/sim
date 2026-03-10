'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/emcn'
import { getFilledPillColor, USAGE_PILL_COLORS, USAGE_THRESHOLDS } from '@/lib/billing/client'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { formatCredits } from '@/lib/billing/credits/conversion'
import { cn } from '@/lib/core/utils/cn'

const PILL_COUNT = 5

type OnDemandState = 'hidden' | 'enable' | 'disable'

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
  onDemandState?: OnDemandState
  onToggleOnDemand?: () => void
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
  onDemandState = 'hidden',
  onToggleOnDemand,
}: UsageHeaderProps) {
  const progress = progressValue ?? (limit > 0 ? Math.min((current / limit) * 100, 100) : 0)
  const filledPillsCount = Math.ceil((progress / 100) * PILL_COUNT)

  const isCritical = isBlocked || progress >= USAGE_THRESHOLDS.CRITICAL
  const isWarning = !isCritical && progress >= USAGE_THRESHOLDS.WARNING
  const filledColor = getFilledPillColor(isCritical, isWarning)

  const showOnDemandBadge = onDemandState !== 'hidden'
  const isOnDemandActive = onDemandState === 'disable'

  return (
    <div className='flex flex-col gap-[12px]'>
      <div className='flex items-center justify-between'>
        <div className='flex flex-col gap-[4px]'>
          <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
            {title}
            {seatsText && (
              <span className='ml-[6px] text-[var(--text-tertiary)]'>({seatsText})</span>
            )}
          </span>
          <div className='flex items-center gap-[4px]'>
            {isBlocked ? (
              <span className='font-medium text-[15px] text-[var(--text-error)]'>
                Payment failed
              </span>
            ) : (
              <>
                <span className='font-medium text-[15px] text-[var(--text-primary)] tabular-nums'>
                  {formatCredits(current)}
                </span>
                <span className='font-medium text-[15px] text-[var(--text-primary)]'>/</span>
                {rightContent ?? (
                  <span className='font-medium text-[15px] text-[var(--text-primary)] tabular-nums'>
                    {formatCredits(limit)}
                    {limit < ON_DEMAND_UNLIMITED && ' credits'}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div
          className={cn(
            'flex flex-col gap-[8px]',
            showOnDemandBadge ? 'items-center' : 'items-end'
          )}
        >
          {showOnDemandBadge ? (
            <Badge
              variant={isOnDemandActive ? 'red' : 'green'}
              size='sm'
              className={cn(onToggleOnDemand ? 'cursor-pointer' : 'cursor-default')}
              onClick={onToggleOnDemand}
            >
              {isOnDemandActive ? 'Disable On-Demand' : 'Enable On-Demand'}
            </Badge>
          ) : (
            showBadge &&
            badgeText && (
              <Badge
                variant={badgeVariant}
                onClick={onBadgeClick}
                className={onBadgeClick ? 'cursor-pointer' : 'cursor-default'}
              >
                {badgeText}
              </Badge>
            )
          )}
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
