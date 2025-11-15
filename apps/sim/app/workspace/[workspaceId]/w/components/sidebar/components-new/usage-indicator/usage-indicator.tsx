'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import {
  canUpgrade,
  getBillingStatus,
  getSubscriptionStatus,
  getUsage,
} from '@/lib/subscription/helpers'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { MIN_SIDEBAR_WIDTH, useSidebarStore } from '@/stores/sidebar/store'

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
 * Animation configuration for usage pills
 * Controls how smoothly and quickly the highlight progresses across pills
 */
const PILL_ANIMATION_TICK_MS = 30
const PILLS_PER_SECOND = 1.8
const PILL_STEP_PER_TICK = (PILLS_PER_SECOND * PILL_ANIMATION_TICK_MS) / 1000

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
  const { data: subscriptionData, isLoading } = useSubscriptionData()
  const sidebarWidth = useSidebarStore((state) => state.sidebarWidth)

  /**
   * Calculate pill count based on sidebar width (6-8 pills dynamically)
   * This provides responsive feedback as the sidebar width changes
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
  const showUpgradeButton = planType === 'free' || isBlocked

  /**
   * Calculate which pills should be filled based on usage percentage
   * Uses shared Math.ceil heuristic but with dynamic pill count (6-8)
   * This ensures consistent calculation logic while maintaining responsive pill count
   */
  const filledPillsCount = Math.ceil((progressPercentage / 100) * pillCount)
  const isAlmostOut = filledPillsCount === pillCount

  const [isHovered, setIsHovered] = useState(false)
  const [wavePosition, setWavePosition] = useState<number | null>(null)
  const [hasWrapped, setHasWrapped] = useState(false)

  const startAnimationIndex = pillCount === 0 ? 0 : Math.min(filledPillsCount, pillCount - 1)

  useEffect(() => {
    if (!isHovered || pillCount <= 0) {
      setWavePosition(null)
      setHasWrapped(false)
      return
    }

    const totalSpan = pillCount
    let wrapped = false
    setHasWrapped(false)
    setWavePosition(0)

    const interval = window.setInterval(() => {
      setWavePosition((prev) => {
        const current = prev ?? 0
        const next = current + PILL_STEP_PER_TICK

        // Mark as wrapped after first complete cycle
        if (next >= totalSpan && !wrapped) {
          wrapped = true
          setHasWrapped(true)
        }

        // Return continuous value, never reset (seamless loop)
        return next
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

  const handleClick = () => {
    try {
      if (onClick) {
        onClick()
        return
      }

      const blocked = getBillingStatus(subscriptionData?.data) === 'blocked'
      const canUpg = canUpgrade(subscriptionData?.data)

      // Open Settings modal to the subscription tab (upgrade UI lives there)
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
      className='group flex flex-shrink-0 cursor-pointer flex-col gap-[8px] border-t px-[13.5px] pt-[8px] pb-[10px]'
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Top row */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-[6px]'>
          <span className='font-medium text-[#FFFFFF] text-[12px]'>{PLAN_NAMES[planType]}</span>
          <div className='h-[14px] w-[1.5px] bg-[var(--divider)]' />
          <div className='flex items-center gap-[4px]'>
            {isBlocked ? (
              <>
                <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Over</span>
                <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>limit</span>
              </>
            ) : (
              <>
                <span className='font-medium text-[12px] text-[var(--text-tertiary)] tabular-nums'>
                  ${usage.current.toFixed(2)}
                </span>
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
            className='-mx-1 !h-auto !px-1 !py-0 !text-[#F473B7] group-hover:!text-[#F789C4] mt-[-2px] transition-colors duration-100'
            onClick={handleClick}
          >
            <span className='font-medium text-[12px]'>Upgrade</span>
          </Button>
        )}
      </div>

      {/* Pills row */}
      <div className='flex items-center gap-[4px]'>
        {Array.from({ length: pillCount }).map((_, i) => {
          const isFilled = i < filledPillsCount

          const baseColor = isFilled ? (isAlmostOut ? '#ef4444' : '#34B5FF') : '#414141'

          let backgroundColor = baseColor
          let backgroundImage: string | undefined

          if (isHovered && wavePosition !== null && pillCount > 0) {
            const totalSpan = pillCount
            const grayColor = '#414141'
            const activeColor = isAlmostOut ? '#ef4444' : '#34B5FF'

            if (!hasWrapped) {
              // First pass: respect original fill state, start from startAnimationIndex
              const headIndex = Math.floor(wavePosition)
              const progress = wavePosition - headIndex

              const pillOffsetFromStart =
                i >= startAnimationIndex
                  ? i - startAnimationIndex
                  : totalSpan - startAnimationIndex + i

              if (pillOffsetFromStart < headIndex) {
                backgroundColor = baseColor
                backgroundImage = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} 100%)`
              } else if (pillOffsetFromStart === headIndex) {
                const fillPercent = Math.max(0, Math.min(1, progress)) * 100
                backgroundColor = baseColor
                backgroundImage = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${fillPercent}%, ${baseColor} ${fillPercent}%, ${baseColor} 100%)`
              }
            } else {
              // Subsequent passes: render wave at BOTH current and next-cycle positions for seamless wrap
              const wrappedPosition = wavePosition % totalSpan
              const currentHead = Math.floor(wrappedPosition)
              const progress = wrappedPosition - currentHead

              // Primary wave position
              const primaryFilled = i < currentHead
              const primaryActive = i === currentHead

              // Secondary wave position (one full cycle ahead, wraps to beginning)
              const secondaryHead = Math.floor(wavePosition + totalSpan) % totalSpan
              const secondaryProgress =
                wavePosition + totalSpan - Math.floor(wavePosition + totalSpan)
              const secondaryFilled = i < secondaryHead
              const secondaryActive = i === secondaryHead

              // Render: pill is filled if either wave position has filled it
              if (primaryFilled || secondaryFilled) {
                backgroundColor = grayColor
                backgroundImage = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} 100%)`
              } else if (primaryActive || secondaryActive) {
                const activeProgress = primaryActive ? progress : secondaryProgress
                const fillPercent = Math.max(0, Math.min(1, activeProgress)) * 100
                backgroundColor = grayColor
                backgroundImage = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${fillPercent}%, ${grayColor} ${fillPercent}%, ${grayColor} 100%)`
              } else {
                backgroundColor = grayColor
              }
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
