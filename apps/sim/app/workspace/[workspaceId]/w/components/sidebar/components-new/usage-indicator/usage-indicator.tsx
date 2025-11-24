'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import {
  canUpgrade,
  getBillingStatus,
  getSubscriptionStatus,
  getUsage,
} from '@/lib/subscription/helpers'
import { isUsageAtLimit, USAGE_PILL_COLORS } from '@/lib/subscription/usage-visualization'
import { RotatingDigit } from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/usage-indicator/rotating-digit'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { subscriptionKeys, useSubscriptionData } from '@/hooks/queries/subscription'
import { MIN_SIDEBAR_WIDTH, useSidebarStore } from '@/stores/sidebar/store'

const logger = createLogger('UsageIndicator')

/**
 * Minimum number of pills to display (at minimum sidebar width).
 */
const MIN_PILL_COUNT = 6

/**
 * Maximum number of pills to display.
 */
const MAX_PILL_COUNT = 8

/**
 * Width increase (in pixels) required to add one additional pill.
 */
const WIDTH_PER_PILL = 50

/**
 * Animation tick interval in milliseconds.
 * Controls the update frequency of the wave animation.
 */
const PILL_ANIMATION_TICK_MS = 30

/**
 * Speed of the wave animation in pills per second.
 */
const PILLS_PER_SECOND = 1.8

/**
 * Distance (in pill units) the wave advances per animation tick.
 * Derived from {@link PILLS_PER_SECOND} and {@link PILL_ANIMATION_TICK_MS}.
 */
const PILL_STEP_PER_TICK = (PILLS_PER_SECOND * PILL_ANIMATION_TICK_MS) / 1000

/**
 * Human-readable plan name labels.
 */
const PLAN_NAMES = {
  enterprise: 'Enterprise',
  team: 'Team',
  pro: 'Pro',
  free: 'Free',
} as const

/**
 * Props for the {@link UsageIndicator} component.
 */
interface UsageIndicatorProps {
  /**
   * Optional click handler. If provided, overrides the default behavior
   * of opening the settings modal to the subscription tab.
   */
  onClick?: () => void
}

/**
 * Displays a visual usage indicator showing current subscription usage
 * with an animated pill bar that responds to hover interactions.
 *
 * The component shows:
 * - Current plan type (Free, Pro, Team, Enterprise)
 * - Current usage vs. limit (e.g., $7.00 / $10.00)
 * - Visual pill bar representing usage percentage
 * - Upgrade button for free plans or when blocked
 *
 * @param props - Component props
 * @returns A usage indicator component with responsive pill visualization
 */
export function UsageIndicator({ onClick }: UsageIndicatorProps) {
  const { data: subscriptionData, isLoading } = useSubscriptionData()
  const sidebarWidth = useSidebarStore((state) => state.sidebarWidth)
  const { onOperationConfirmed } = useSocket()
  const queryClient = useQueryClient()

  // Listen for completed operations to update usage
  useEffect(() => {
    const handleOperationConfirmed = () => {
      // Small delay to ensure backend has updated usage
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.user() })
      }, 1000)
    }

    onOperationConfirmed(handleOperationConfirmed)
  }, [onOperationConfirmed, queryClient])

  /**
   * Calculate pill count based on sidebar width (6-8 pills dynamically).
   * This provides responsive feedback as the sidebar width changes.
   */
  const pillCount = useMemo(() => {
    const widthDelta = sidebarWidth - MIN_SIDEBAR_WIDTH
    const additionalPills = Math.floor(widthDelta / WIDTH_PER_PILL)
    const calculatedCount = MIN_PILL_COUNT + additionalPills
    return Math.max(MIN_PILL_COUNT, Math.min(MAX_PILL_COUNT, calculatedCount))
  }, [sidebarWidth])

  const usage = getUsage(subscriptionData?.data)
  const subscription = getSubscriptionStatus(subscriptionData?.data)

  const progressPercentage = Math.min(usage.percentUsed, 100)

  const planType = subscription.isEnterprise
    ? 'enterprise'
    : subscription.isTeam
      ? 'team'
      : subscription.isPro
        ? 'pro'
        : 'free'

  const billingStatus = getBillingStatus(subscriptionData?.data)
  const isBlocked = billingStatus === 'blocked'
  const showUpgradeButton =
    (planType === 'free' || isBlocked || progressPercentage >= 80) && planType !== 'enterprise'

  /**
   * Calculate which pills should be filled based on usage percentage.
   * Uses a percentage-based heuristic with dynamic pill count (6-8).
   * The warning/limit (red) state is derived from shared usage visualization utilities
   * so it is consistent with other parts of the app (e.g. UsageHeader).
   */
  const filledPillsCount = Math.ceil((progressPercentage / 100) * pillCount)
  const isAtLimit = isUsageAtLimit(progressPercentage)

  const [isHovered, setIsHovered] = useState(false)
  const [wavePosition, setWavePosition] = useState<number | null>(null)

  const startAnimationIndex = pillCount === 0 ? 0 : Math.min(filledPillsCount, pillCount - 1)

  useEffect(() => {
    // Animation enabled for all plans on hover
    if (!isHovered || pillCount <= 0) {
      setWavePosition(null)
      return
    }

    /**
     * Maximum distance (in pill units) the wave should travel from
     * {@link startAnimationIndex} to the end of the row. The wave stops
     * once it reaches the final pill and does not wrap.
     */
    const maxDistance = pillCount <= 0 ? 0 : Math.max(0, pillCount - startAnimationIndex)

    setWavePosition(0)

    const interval = window.setInterval(() => {
      setWavePosition((prev) => {
        const current = prev ?? 0

        if (current >= maxDistance) {
          return current
        }

        const next = current + PILL_STEP_PER_TICK
        return next >= maxDistance ? maxDistance : next
      })
    }, PILL_ANIMATION_TICK_MS)

    return () => {
      window.clearInterval(interval)
    }
  }, [isHovered, pillCount, startAnimationIndex])

  if (isLoading) {
    return (
      <div className='flex flex-shrink-0 flex-col gap-[8px] border-t pt-[12px] pr-[13.5px] pb-[10px] pl-[12px] dark:border-[var(--border)]'>
        {/* Top row skeleton */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[6px]'>
            <Skeleton className='h-[14px] w-[40px] rounded-[4px]' />
            <Skeleton className='h-[14px] w-[70px] rounded-[4px]' />
          </div>
          <Skeleton className='h-[12px] w-[50px] rounded-[4px]' />
        </div>

        {/* Pills skeleton */}
        <div className='flex items-center gap-[4px]'>
          {Array.from({ length: pillCount }).map((_, i) => (
            <Skeleton key={i} className='h-[6px] flex-1 rounded-[2px]' />
          ))}
        </div>
      </div>
    )
  }

  const handleClick = async () => {
    try {
      if (onClick) {
        onClick()
        return
      }

      const blocked = getBillingStatus(subscriptionData?.data) === 'blocked'
      const canUpg = canUpgrade(subscriptionData?.data)

      if (blocked) {
        try {
          const context = subscription.isTeam || subscription.isEnterprise ? 'organization' : 'user'
          const organizationId =
            subscription.isTeam || subscription.isEnterprise
              ? subscriptionData?.data?.organization?.id
              : undefined

          const response = await fetch('/api/billing/portal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context, organizationId }),
          })

          if (response.ok) {
            const { url } = await response.json()
            window.open(url, '_blank')
            logger.info('Opened billing portal for blocked account', { context, organizationId })
            return
          }
        } catch (portalError) {
          logger.warn('Failed to open billing portal, falling back to settings', {
            error: portalError,
          })
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'subscription' } }))
        logger.info('Opened settings to subscription tab', { blocked, canUpgrade: canUpg })
      }
    } catch (error) {
      logger.error('Failed to handle usage indicator click', { error })
    }
  }

  return (
    <div
      className={`group flex flex-shrink-0 cursor-pointer flex-col gap-[8px] border-t px-[13.5px] pt-[8px] pb-[10px] ${
        isBlocked ? 'border-red-500/50 bg-red-950/20' : ''
      }`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Top row */}
      <div className='flex items-center justify-between'>
        <div className='flex min-w-0 flex-1 items-center gap-[6px]'>
          <span className='flex-shrink-0 font-medium text-[#FFFFFF] text-[12px]'>
            {PLAN_NAMES[planType]}
          </span>
          <div className='h-[14px] w-[1.5px] flex-shrink-0 bg-[var(--divider)]' />
          <div className='flex min-w-0 flex-1 items-center gap-[4px]'>
            {isBlocked ? (
              <>
                <span className='font-medium text-[12px] text-red-400'>Payment</span>
                <span className='font-medium text-[12px] text-red-400'>Required</span>
              </>
            ) : (
              <>
                <div className='flex items-center font-medium text-[12px] text-[var(--text-tertiary)]'>
                  <span className='mr-[1px]'>$</span>
                  <RotatingDigit
                    value={usage.current}
                    height={14}
                    width={7}
                    textClassName='font-medium text-[12px] text-[var(--text-tertiary)] tabular-nums'
                  />
                </div>
                <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>/</span>
                <span className='font-medium text-[12px] text-[var(--text-tertiary)] tabular-nums'>
                  ${usage.limit}
                </span>
              </>
            )}
          </div>
        </div>
        {showUpgradeButton && (
          <Button
            variant='ghost'
            className={`-mx-1 !h-auto !px-1 !py-0 mt-[-2px] transition-colors duration-100 ${
              isBlocked
                ? '!text-red-400 group-hover:!text-red-300'
                : '!text-[#F473B7] group-hover:!text-[#F789C4]'
            }`}
            onClick={handleClick}
          >
            <span className='font-medium text-[12px]'>{isBlocked ? 'Fix Now' : 'Upgrade'}</span>
          </Button>
        )}
      </div>

      {/* Pills row */}
      <div className='flex items-center gap-[4px]'>
        {Array.from({ length: pillCount }).map((_, i) => {
          const isFilled = i < filledPillsCount

          const baseColor = isFilled
            ? isBlocked || isAtLimit
              ? USAGE_PILL_COLORS.AT_LIMIT
              : USAGE_PILL_COLORS.FILLED
            : USAGE_PILL_COLORS.UNFILLED

          let backgroundColor = baseColor
          let backgroundImage: string | undefined

          if (isHovered && wavePosition !== null && pillCount > 0) {
            const grayColor = USAGE_PILL_COLORS.UNFILLED
            const activeColor = isAtLimit ? USAGE_PILL_COLORS.AT_LIMIT : USAGE_PILL_COLORS.FILLED

            /**
             * Single-pass wave: travel from {@link startAnimationIndex} to the end
             * of the row without wrapping. Previously highlighted pills remain
             * filled; the wave only affects pills at or after the start index.
             */
            const headIndex = Math.floor(wavePosition)
            const progress = wavePosition - headIndex

            const pillOffsetFromStart = i - startAnimationIndex

            if (pillOffsetFromStart < 0) {
            } else if (pillOffsetFromStart < headIndex) {
              backgroundColor = isFilled ? baseColor : grayColor
              backgroundImage = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} 100%)`
            } else if (pillOffsetFromStart === headIndex) {
              const fillPercent = Math.max(0, Math.min(1, progress)) * 100
              backgroundColor = isFilled ? baseColor : grayColor
              backgroundImage = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${fillPercent}%, ${
                isFilled ? baseColor : grayColor
              } ${fillPercent}%, ${isFilled ? baseColor : grayColor} 100%)`
            } else {
              backgroundColor = isFilled ? baseColor : grayColor
            }
          }

          return (
            <div
              key={i}
              className='h-[6px] flex-1 rounded-[2px]'
              style={{
                backgroundColor,
                backgroundImage,
                transition: isHovered ? 'none' : 'background-color 200ms',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
