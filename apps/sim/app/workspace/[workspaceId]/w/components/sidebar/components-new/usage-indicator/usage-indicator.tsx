'use client'

import { useEffect, useMemo } from 'react'
import { Button } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { MIN_SIDEBAR_WIDTH, useSidebarStore } from '@/stores/sidebar/store'
import { useSubscriptionStore } from '@/stores/subscription/store'

const logger = createLogger('UsageIndicator')

/**
 * Minimum number of pills to display (at minimum sidebar width)
 */
const MIN_PILL_COUNT = 6

/**
 * Maximum number of pills to display
 */
const MAX_PILL_COUNT = 8

/**
 * Width increase (in pixels) required to add one additional pill
 */
const WIDTH_PER_PILL = 50

/**
 * Plan name mapping
 */
const PLAN_NAMES = {
  enterprise: 'Enterprise',
  team: 'Team',
  pro: 'Pro',
  free: 'Free',
} as const

interface UsageIndicatorProps {
  onClick?: () => void
}

export function UsageIndicator({ onClick }: UsageIndicatorProps) {
  const { getUsage, getSubscriptionStatus, isLoading } = useSubscriptionStore()
  const sidebarWidth = useSidebarStore((state) => state.sidebarWidth)

  useEffect(() => {
    useSubscriptionStore.getState().loadData()
  }, [])

  /**
   * Calculate pill count based on sidebar width
   * Starts at MIN_PILL_COUNT at minimum width, adds 1 pill per WIDTH_PER_PILL increase
   */
  const pillCount = useMemo(() => {
    const widthDelta = sidebarWidth - MIN_SIDEBAR_WIDTH
    const additionalPills = Math.floor(widthDelta / WIDTH_PER_PILL)
    const calculatedCount = MIN_PILL_COUNT + additionalPills
    return Math.max(MIN_PILL_COUNT, Math.min(MAX_PILL_COUNT, calculatedCount))
  }, [sidebarWidth])

  const usage = getUsage()
  const subscription = getSubscriptionStatus()

  if (isLoading) {
    return (
      <div className='flex flex-shrink-0 flex-col gap-[10px] border-t px-[13.5px] pt-[10px] pb-[8px] dark:border-[var(--border)]'>
        {/* Top row skeleton */}
        <div className='flex items-center justify-between'>
          <Skeleton className='h-[16px] w-[120px] rounded-[4px]' />
          <Skeleton className='h-[16px] w-[50px] rounded-[4px]' />
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

  const progressPercentage = Math.min(usage.percentUsed, 100)

  const planType = subscription.isEnterprise
    ? 'enterprise'
    : subscription.isTeam
      ? 'team'
      : subscription.isPro
        ? 'pro'
        : 'free'

  const billingStatus = useSubscriptionStore.getState().getBillingStatus()
  const isBlocked = billingStatus === 'blocked'
  const showUpgradeButton = planType === 'free' || isBlocked

  /**
   * Calculate which pills should be filled based on usage percentage
   */
  const filledPillsCount = Math.ceil((progressPercentage / 100) * pillCount)
  const isAlmostOut = filledPillsCount === pillCount

  const handleClick = () => {
    try {
      if (onClick) {
        onClick()
        return
      }

      const subscriptionStore = useSubscriptionStore.getState()
      const blocked = subscriptionStore.getBillingStatus() === 'blocked'
      const canUpgrade = subscriptionStore.canUpgrade()

      // Open Settings modal to the subscription tab (upgrade UI lives there)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'subscription' } }))
        logger.info('Opened settings to subscription tab', { blocked, canUpgrade })
      }
    } catch (error) {
      logger.error('Failed to handle usage indicator click', { error })
    }
  }

  return (
    <div className='flex flex-shrink-0 flex-col gap-[10px] border-t px-[13.5px] pt-[8px] pb-[8px] dark:border-[var(--border)]'>
      {/* Top row */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-[6px]'>
          <span className='font-medium text-[#FFFFFF] text-[12px]'>{PLAN_NAMES[planType]}</span>
          <div className='h-[14px] w-[1.5px] bg-[#4A4A4A]' />
          <div className='flex items-center gap-[4px]'>
            {isBlocked ? (
              <>
                <span className='font-medium text-[#B1B1B1] text-[12px]'>Over</span>
                <span className='font-medium text-[#B1B1B1] text-[12px]'>limit</span>
              </>
            ) : (
              <>
                <span className='font-medium text-[#B1B1B1] text-[12px] tabular-nums'>
                  ${usage.current.toFixed(2)}
                </span>
                <span className='font-medium text-[#B1B1B1] text-[12px]'>/</span>
                <span className='font-medium text-[#B1B1B1] text-[12px] tabular-nums'>
                  ${usage.limit}
                </span>
              </>
            )}
          </div>
        </div>
        {showUpgradeButton && (
          <Button
            variant='ghost'
            className='!h-auto !px-1 !py-0 -mx-1 mt-[-2px] text-[#D4D4D4]'
            onClick={handleClick}
          >
            Upgrade
          </Button>
        )}
      </div>

      {/* Pills row */}
      <div className='flex items-center gap-[4px]'>
        {Array.from({ length: pillCount }).map((_, i) => {
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
    </div>
  )
}
