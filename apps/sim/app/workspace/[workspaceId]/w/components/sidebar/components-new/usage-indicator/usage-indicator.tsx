'use client'

import { useEffect } from 'react'
import { Badge, Progress, Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useSubscriptionStore } from '@/stores/subscription/store'

// Constants for reusable styles
const GRADIENT_BADGE_STYLES =
  'gradient-text h-[1.125rem] rounded-[6px] border-gradient-primary/20 bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary px-2 py-0 font-medium text-xs'
const GRADIENT_TEXT_STYLES =
  'gradient-text bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary'
const CONTAINER_STYLES =
  'pointer-events-auto flex-shrink-0 rounded-[10px] border bg-background px-3 py-2.5 shadow-xs cursor-pointer transition-colors hover:bg-muted/50'

const logger = createLogger('UsageIndicator')

// Plan name mapping
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

  useEffect(() => {
    useSubscriptionStore.getState().loadData()
  }, [])

  const usage = getUsage()
  const subscription = getSubscriptionStatus()

  if (isLoading) {
    return (
      <div className={CONTAINER_STYLES} onClick={() => onClick?.()}>
        <div className='space-y-2'>
          {/* Plan and usage info skeleton */}
          <div className='flex items-center justify-between'>
            <Skeleton className='h-5 w-12' />
            <Skeleton className='h-4 w-20' />
          </div>

          {/* Progress Bar skeleton */}
          <Skeleton className='h-2 w-full' />
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
  const badgeText = isBlocked ? 'Payment Failed' : planType === 'free' ? 'Upgrade' : undefined

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
    <div className={CONTAINER_STYLES} onClick={handleClick}>
      <div className='space-y-2'>
        {/* Plan and usage info */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span
              className={cn(
                'font-medium text-sm',
                planType === 'free' ? 'text-foreground' : GRADIENT_TEXT_STYLES
              )}
            >
              {PLAN_NAMES[planType]}
            </span>
            {badgeText ? <Badge className={GRADIENT_BADGE_STYLES}>{badgeText}</Badge> : null}
          </div>
          <span className='text-muted-foreground text-xs tabular-nums'>
            {isBlocked ? 'Payment required' : `$${usage.current.toFixed(2)} / $${usage.limit}`}
          </span>
        </div>

        {/* Progress Bar */}
        <Progress
          value={isBlocked ? 100 : progressPercentage}
          className='h-2'
          indicatorClassName='bg-black dark:bg-white'
        />
      </div>
    </div>
  )
}
