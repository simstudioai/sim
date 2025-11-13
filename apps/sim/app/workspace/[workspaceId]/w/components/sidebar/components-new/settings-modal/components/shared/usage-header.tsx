'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/emcn'
import { cn } from '@/lib/utils'

const GRADIENT_BADGE_STYLES =
  'gradient-text h-[1.125rem] rounded-[6px] border-gradient-primary/20 bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary px-2 py-0 font-medium text-xs cursor-pointer'

// Constants matching UsageIndicator
const PILL_COUNT = 8

interface UsageHeaderProps {
  title: string
  gradientTitle?: boolean
  showBadge?: boolean
  badgeText?: string
  onBadgeClick?: () => void
  rightContent?: ReactNode
  current: number
  limit: number
  progressValue?: number
  seatsText?: string
  isBlocked?: boolean
  onResolvePayment?: () => void
  status?: 'ok' | 'warning' | 'exceeded' | 'blocked'
  percentUsed?: number
}

export function UsageHeader({
  title,
  gradientTitle = false,
  showBadge = false,
  badgeText,
  onBadgeClick,
  rightContent,
  current,
  limit,
  progressValue,
  seatsText,
  isBlocked,
  onResolvePayment,
  status,
  percentUsed,
}: UsageHeaderProps) {
  const progress = progressValue ?? (limit > 0 ? Math.min((current / limit) * 100, 100) : 0)

  // Calculate filled pills based on usage percentage
  const filledPillsCount = Math.ceil((progress / 100) * PILL_COUNT)
  const isAlmostOut = filledPillsCount === PILL_COUNT

  return (
    <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
      <div className='space-y-2'>
        {/* Top row */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span
              className={cn(
                'font-medium text-[12px]',
                gradientTitle
                  ? 'gradient-text bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary'
                  : 'text-[#FFFFFF]'
              )}
            >
              {title}
            </span>
            {showBadge && badgeText ? (
              <Badge className={GRADIENT_BADGE_STYLES} onClick={onBadgeClick}>
                {badgeText}
              </Badge>
            ) : null}
            {seatsText ? (
              <span className='text-muted-foreground text-xs'>({seatsText})</span>
            ) : null}
          </div>
          <div className='flex items-center gap-[4px] text-xs tabular-nums'>
            {isBlocked ? (
              <span className='font-medium text-[#B1B1B1] text-[12px]'>Payment required</span>
            ) : (
              <>
                <span className='font-medium text-[#B1B1B1] text-[12px] tabular-nums'>
                  ${current.toFixed(2)}
                </span>
                <span className='font-medium text-[#B1B1B1] text-[12px]'>/</span>
                {rightContent ?? (
                  <span className='font-medium text-[#B1B1B1] text-[12px] tabular-nums'>
                    ${limit}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pills row - matching UsageIndicator */}
        <div className='flex items-center gap-[4px]'>
          {Array.from({ length: PILL_COUNT }).map((_, i) => {
            const isFilled = i < filledPillsCount
            return (
              <div
                key={i}
                className='h-[6px] flex-1 rounded-[2px]'
                style={{
                  backgroundColor: isFilled ? (isAlmostOut ? '#ef4444' : '#34B5FF') : '#414141',
                }}
              />
            )
          })}
        </div>

        {/* Status messages */}
        {isBlocked && (
          <div className='flex items-center justify-between rounded-[6px] bg-destructive/10 px-2 py-1'>
            <span className='text-destructive text-xs'>
              Payment failed. Please update your payment method.
            </span>
            {onResolvePayment && (
              <button
                type='button'
                className='font-medium text-destructive text-xs underline underline-offset-2'
                onClick={onResolvePayment}
              >
                Resolve payment
              </button>
            )}
          </div>
        )}

        {!isBlocked && status === 'exceeded' && (
          <div className='rounded-[6px] bg-amber-900/10 px-2 py-1'>
            <span className='text-amber-600 text-xs'>
              Usage limit exceeded. Increase your limit to continue.
            </span>
          </div>
        )}

        {!isBlocked && status === 'warning' && (
          <div className='rounded-[6px] bg-yellow-900/10 px-2 py-1'>
            <span className='text-xs text-yellow-600'>
              {typeof percentUsed === 'number' ? `${percentUsed}%` : '80%+'} of your limit used.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
