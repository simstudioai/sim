'use client'

import { useEffect } from 'react'
import { Badge, Progress, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useSubscriptionStore } from '@/stores/subscription/store'

// Constants for reusable styles
const GRADIENT_BADGE_STYLES =
  'gradient-text h-[1.125rem] rounded-[6px] border-gradient-primary/20 bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary px-2 py-0 font-medium text-xs'
const GRADIENT_TEXT_STYLES =
  'gradient-text bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary'
const CONTAINER_STYLES =
  'pointer-events-auto flex-shrink-0 rounded-[10px] border bg-background px-3 py-2.5 shadow-xs cursor-pointer transition-colors hover:bg-muted/50'

// Plan name mapping
const PLAN_NAMES = {
  enterprise: 'Enterprise',
  team: 'Team',
  pro: 'Pro',
  free: 'Free',
} as const

interface UsageIndicatorProps {
  onClick?: (badgeType: 'add' | 'upgrade') => void
}

export function UsageIndicator({ onClick }: UsageIndicatorProps) {
  const { loadData, getUsage, getSubscriptionStatus, isLoading } = useSubscriptionStore()

  // Load subscription data on mount
  useEffect(() => {
    loadData()
  }, [loadData])

  const usage = getUsage()
  const subscription = getSubscriptionStatus()

  // Show skeleton while loading
  if (isLoading) {
    return (
      <div className={CONTAINER_STYLES} onClick={() => onClick?.('upgrade')}>
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

  // Calculate progress percentage (capped at 100)
  const progressPercentage = Math.min(usage.percentUsed, 100)

  // Determine plan type
  const planType = subscription.isEnterprise
    ? 'enterprise'
    : subscription.isTeam
      ? 'team'
      : subscription.isPro
        ? 'pro'
        : 'free'

  // Determine badge to show
  const showAddBadge = planType !== 'free' && usage.percentUsed >= 50
  const badgeText = planType === 'free' ? 'Upgrade' : 'Add'
  const badgeType = planType === 'free' ? 'upgrade' : 'add'

  return (
    <div className={CONTAINER_STYLES} onClick={() => onClick?.(badgeType)}>
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
            {(showAddBadge || planType === 'free') && (
              <Badge className={GRADIENT_BADGE_STYLES}>{badgeText}</Badge>
            )}
          </div>
          <span className='text-muted-foreground text-xs tabular-nums'>
            ${usage.current.toFixed(2)} / ${usage.limit}
          </span>
        </div>

        {/* Progress Bar */}
        <Progress value={progressPercentage} className='h-2' />
      </div>
    </div>
  )
}
