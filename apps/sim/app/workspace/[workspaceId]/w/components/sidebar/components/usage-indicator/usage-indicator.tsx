'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { USAGE_PILL_COLORS, USAGE_THRESHOLDS } from '@/lib/billing/client/consts'
import { useSubscriptionUpgrade } from '@/lib/billing/client/upgrade'
import {
  getBillingStatus,
  getFilledPillColor,
  getSubscriptionStatus,
  getUsage,
} from '@/lib/billing/client/utils'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { subscriptionKeys, useSubscriptionData } from '@/hooks/queries/subscription'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useSidebarStore } from '@/stores/sidebar/store'
import { UsageIndicatorContextMenu } from './usage-indicator-context-menu'

const logger = createLogger('UsageIndicator')

/**
 * Pill display configuration.
 */
const PILL_CONFIG = {
  MIN_COUNT: 6,
  MAX_COUNT: 8,
  WIDTH_PER_PILL: 50,
  ANIMATION_TICK_MS: 30,
  PILLS_PER_SECOND: 1.8,
} as const

const PILL_STEP_PER_TICK = (PILL_CONFIG.PILLS_PER_SECOND * PILL_CONFIG.ANIMATION_TICK_MS) / 1000

/**
 * Display width costs in "digit equivalents" for responsive layout.
 */
const WIDTH_COSTS = {
  BADGE: 6,
  BLOCKED_TEXT: 4,
  WIDTH_PER_EXTRA_DIGIT: 10,
} as const

/**
 * Base digit capacity by plan type (without badge).
 */
const PLAN_DIGIT_CAPACITY = {
  enterprise: 14,
  team: 14,
  pro: 14,
  free: 14,
} as const

const PLAN_NAMES = {
  enterprise: 'Enterprise',
  team: 'Team',
  pro: 'Pro',
  free: 'Free',
} as const

type PlanType = keyof typeof PLAN_NAMES
type OrgRole = 'owner' | 'admin' | 'member'

interface DisplayState {
  planType: PlanType
  isBlocked: boolean
  isDispute: boolean
  isCritical: boolean
  isWarning: boolean
  canManageBilling: boolean
}

interface BadgeConfig {
  show: boolean
  variant: 'red' | 'blue-secondary'
  label: string
}

interface StatusTextConfig {
  text: string
  isError: boolean
}

/**
 * Determines if user can manage billing based on plan type and org role.
 *
 * @param planType - The user's current plan type
 * @param orgRole - The user's role in the organization, if applicable
 * @returns True if the user has billing management permissions
 */
function canManageBilling(planType: PlanType, orgRole: OrgRole | null): boolean {
  if (planType === 'free' || planType === 'pro') return true
  if (planType === 'team' || planType === 'enterprise') {
    return orgRole === 'owner' || orgRole === 'admin'
  }
  return false
}

/**
 * Determines the badge configuration based on display state.
 *
 * Priority order:
 * 1. Blocked/dispute states (all users including free with past due payments)
 * 2. Free users see upgrade badge
 * 3. Critical usage shows "Get Help" (enterprise) or "Set Limit" (others)
 *
 * @param state - The current display state
 * @returns Badge configuration with visibility, variant, and label
 */
function getBadgeConfig(state: DisplayState): BadgeConfig {
  const { isBlocked, isDispute, planType, isCritical, canManageBilling } = state

  if (isDispute && canManageBilling) {
    return { show: true, variant: 'red', label: 'Get Help' }
  }
  if (isBlocked && canManageBilling) {
    return { show: true, variant: 'red', label: 'Fix Now' }
  }

  if (planType === 'free') {
    return { show: true, variant: 'blue-secondary', label: 'Upgrade' }
  }

  if (isCritical && canManageBilling) {
    const label = planType === 'enterprise' ? 'Get Help' : 'Set Limit'
    return { show: true, variant: 'red', label }
  }

  return { show: false, variant: 'blue-secondary', label: '' }
}

/**
 * Determines the status text configuration for the usage display.
 *
 * @param isBlocked - Whether billing is blocked
 * @param isDispute - Whether there is a payment dispute
 * @param usage - Current and limit usage values
 * @returns Status text configuration with display text and error state
 */
function getStatusTextConfig(
  isBlocked: boolean,
  isDispute: boolean,
  usage: { current: number; limit: number }
): StatusTextConfig {
  if (isBlocked || isDispute) {
    return {
      text: 'Payment failed',
      isError: true,
    }
  }
  return {
    text: `$${usage.current.toFixed(2)} / $${usage.limit.toFixed(2)}`,
    isError: false,
  }
}

/**
 * Calculates whether plan text fits based on available sidebar space.
 *
 * @param planType - The user's current plan type
 * @param usage - Current and limit usage values
 * @param sidebarWidth - Current sidebar width in pixels
 * @param badgeShowing - Whether a badge is currently displayed
 * @param isBlocked - Whether billing is blocked
 * @returns True if plan text should be displayed
 */
function shouldShowPlanText(
  planType: PlanType,
  usage: { current: number; limit: number },
  sidebarWidth: number,
  badgeShowing: boolean,
  isBlocked: boolean
): boolean {
  const countDigits = (value: number): number => value.toFixed(2).replace(/\D/g, '').length

  const usageDigits = countDigits(usage.current) + countDigits(usage.limit)
  const extraWidth = Math.max(0, sidebarWidth - SIDEBAR_WIDTH.MIN)
  const bonusDigits = Math.floor(extraWidth / WIDTH_COSTS.WIDTH_PER_EXTRA_DIGIT)

  let totalCost = usageDigits
  if (badgeShowing) totalCost += WIDTH_COSTS.BADGE
  if (isBlocked) totalCost += WIDTH_COSTS.BLOCKED_TEXT

  const capacity = PLAN_DIGIT_CAPACITY[planType] + bonusDigits
  return totalCost <= capacity
}

interface UsageIndicatorProps {
  onClick?: () => void
}

const TYPEFORM_ENTERPRISE_URL = 'https://form.typeform.com/to/jqCO12pF'

/**
 * Displays a visual usage indicator with animated pill bar.
 */
export function UsageIndicator({ onClick }: UsageIndicatorProps) {
  const { data: subscriptionData, isLoading } = useSubscriptionData({ includeOrg: true })
  const sidebarWidth = useSidebarStore((state) => state.sidebarWidth)
  const { onOperationConfirmed } = useSocket()
  const queryClient = useQueryClient()
  const { handleUpgrade } = useSubscriptionUpgrade()

  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
    handleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  useEffect(() => {
    const handleOperationConfirmed = () => {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
      }, 1000)
    }
    onOperationConfirmed(handleOperationConfirmed)
  }, [onOperationConfirmed, queryClient])

  const usage = getUsage(subscriptionData?.data)
  const subscription = getSubscriptionStatus(subscriptionData?.data)
  const billingStatus = getBillingStatus(subscriptionData?.data)

  const progressPercentage = Math.min(usage.percentUsed, 100)
  const isBlocked = billingStatus === 'blocked'
  const blockedReason = subscriptionData?.data?.billingBlockedReason as
    | 'payment_failed'
    | 'dispute'
    | null
  const isDispute = isBlocked && blockedReason === 'dispute'

  const orgRole = (subscriptionData?.data?.organization?.role as OrgRole) ?? null

  const planType: PlanType = subscription.isEnterprise
    ? 'enterprise'
    : subscription.isTeam
      ? 'team'
      : subscription.isPro
        ? 'pro'
        : 'free'

  const isCritical = isBlocked || progressPercentage >= USAGE_THRESHOLDS.CRITICAL
  const isWarning = !isCritical && progressPercentage >= USAGE_THRESHOLDS.WARNING
  const userCanManageBilling = canManageBilling(planType, orgRole)

  const displayState: DisplayState = {
    planType,
    isBlocked,
    isDispute,
    isCritical,
    isWarning,
    canManageBilling: userCanManageBilling,
  }

  const badgeConfig = useMemo(
    () => getBadgeConfig(displayState),
    [isBlocked, isDispute, planType, isCritical, userCanManageBilling]
  )

  const statusText = useMemo(
    () => getStatusTextConfig(isBlocked, isDispute, usage),
    [isBlocked, isDispute, usage.current, usage.limit]
  )

  const showPlanText = useMemo(
    () => shouldShowPlanText(planType, usage, sidebarWidth, badgeConfig.show, isBlocked),
    [planType, usage.current, usage.limit, sidebarWidth, badgeConfig.show, isBlocked]
  )

  const pillCount = useMemo(() => {
    const widthDelta = sidebarWidth - SIDEBAR_WIDTH.MIN
    const additionalPills = Math.floor(widthDelta / PILL_CONFIG.WIDTH_PER_PILL)
    const calculatedCount = PILL_CONFIG.MIN_COUNT + additionalPills
    return Math.max(PILL_CONFIG.MIN_COUNT, Math.min(PILL_CONFIG.MAX_COUNT, calculatedCount))
  }, [sidebarWidth])

  const filledPillsCount = Math.ceil((progressPercentage / 100) * pillCount)
  const filledColor = getFilledPillColor(isCritical, isWarning)

  const isFree = planType === 'free'
  const isPro = planType === 'pro'
  const isTeam = planType === 'team'
  const isEnterprise = planType === 'enterprise'

  const handleUpgradeToPro = useCallback(async () => {
    try {
      await handleUpgrade('pro')
    } catch (error) {
      logger.error('Failed to upgrade to Pro', { error })
    }
  }, [handleUpgrade])

  const handleUpgradeToTeam = useCallback(async () => {
    try {
      await handleUpgrade('team')
    } catch (error) {
      logger.error('Failed to upgrade to Team', { error })
    }
  }, [handleUpgrade])

  const handleSetLimit = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'subscription' } }))
  }, [])

  const handleManageSeats = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'team' } }))
  }, [])

  const handleUpgradeToEnterprise = useCallback(() => {
    window.open(TYPEFORM_ENTERPRISE_URL, '_blank')
  }, [])

  const handleContactSupport = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-help-modal'))
  }, [])

  const contextMenuItems = useMemo(
    () => ({
      // Set limit: Only for Pro and Team admins (not free, not enterprise)
      showSetLimit: (isPro || (isTeam && userCanManageBilling)) && !isEnterprise,
      // Upgrade to Pro: Only for free users
      showUpgradeToPro: isFree,
      // Upgrade to Team: Free users and Pro users with billing permission
      showUpgradeToTeam: isFree || (isPro && userCanManageBilling),
      // Manage seats: Only for Team admins
      showManageSeats: isTeam && userCanManageBilling,
      // Upgrade to Enterprise: Only for Team admins (not free, not pro, not enterprise)
      showUpgradeToEnterprise: isTeam && userCanManageBilling,
      // Contact support: Only for Enterprise admins
      showContactSupport: isEnterprise && userCanManageBilling,
      onSetLimit: handleSetLimit,
      onUpgradeToPro: handleUpgradeToPro,
      onUpgradeToTeam: handleUpgradeToTeam,
      onManageSeats: handleManageSeats,
      onUpgradeToEnterprise: handleUpgradeToEnterprise,
      onContactSupport: handleContactSupport,
    }),
    [
      isFree,
      isPro,
      isTeam,
      isEnterprise,
      userCanManageBilling,
      handleSetLimit,
      handleUpgradeToPro,
      handleUpgradeToTeam,
      handleManageSeats,
      handleUpgradeToEnterprise,
      handleContactSupport,
    ]
  )

  // Check if any context menu items will be visible
  const hasContextMenuItems =
    contextMenuItems.showSetLimit ||
    contextMenuItems.showUpgradeToPro ||
    contextMenuItems.showUpgradeToTeam ||
    contextMenuItems.showManageSeats ||
    contextMenuItems.showUpgradeToEnterprise ||
    contextMenuItems.showContactSupport

  const handleContextMenuWithCheck = useCallback(
    (e: React.MouseEvent) => {
      if (!hasContextMenuItems) return
      handleContextMenu(e)
    },
    [hasContextMenuItems, handleContextMenu]
  )

  const [isHovered, setIsHovered] = useState(false)
  const [wavePosition, setWavePosition] = useState<number | null>(null)

  const startAnimationIndex = pillCount === 0 ? 0 : Math.min(filledPillsCount, pillCount - 1)

  useEffect(() => {
    if (!isHovered || pillCount <= 0) {
      setWavePosition(null)
      return
    }

    const maxDistance = Math.max(0, pillCount - startAnimationIndex)
    setWavePosition(0)

    const interval = window.setInterval(() => {
      setWavePosition((prev) => {
        const current = prev ?? 0
        if (current >= maxDistance) return current
        const next = current + PILL_STEP_PER_TICK
        return next >= maxDistance ? maxDistance : next
      })
    }, PILL_CONFIG.ANIMATION_TICK_MS)

    return () => window.clearInterval(interval)
  }, [isHovered, pillCount, startAnimationIndex])

  if (isLoading && !subscriptionData) {
    return (
      <div className='flex flex-shrink-0 flex-col gap-[8px] border-t px-[13.5px] pt-[8px] pb-[10px]'>
        <div className='flex h-[18px] items-center justify-between'>
          <div className='flex min-w-0 flex-1 items-center gap-[6px]'>
            <Skeleton className='h-[12px] w-[28px] rounded-[4px]' />
            <div className='h-[14px] w-[1.5px] flex-shrink-0 bg-[var(--divider)]' />
            <Skeleton className='h-[12px] w-[90px] rounded-[4px]' />
          </div>
          <Skeleton className='h-[16px] w-[50px] rounded-[6px]' />
        </div>
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

      if (isDispute) {
        window.dispatchEvent(new CustomEvent('open-help-modal'))
        logger.info('Opened help modal for disputed account')
        return
      }

      if (isBlocked && userCanManageBilling) {
        try {
          const context = subscription.isTeam || subscription.isEnterprise ? 'organization' : 'user'
          const organizationId = subscriptionData?.data?.organization?.id

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
        logger.info('Opened settings to subscription tab')
      }
    } catch (error) {
      logger.error('Failed to handle usage indicator click', { error })
    }
  }

  return (
    <>
      <div
        className='group flex flex-shrink-0 cursor-pointer flex-col gap-[8px] border-t px-[13.5px] pt-[8px] pb-[10px]'
        onClick={handleClick}
        onContextMenu={handleContextMenuWithCheck}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Top row */}
        <div className='flex h-[18px] items-center justify-between'>
          <div className='flex min-w-0 flex-1 items-center gap-[6px]'>
            {showPlanText && (
              <>
                <span className='flex-shrink-0 font-medium text-[12px] text-[var(--text-primary)]'>
                  {PLAN_NAMES[planType]}
                </span>
                <div className='h-[14px] w-[1.5px] flex-shrink-0 bg-[var(--divider)]' />
              </>
            )}
            <div className='flex min-w-0 flex-1 items-center gap-[4px]'>
              {statusText.isError ? (
                <span className='font-medium text-[12px] text-[var(--text-error)]'>
                  {statusText.text}
                </span>
              ) : (
                <>
                  <span className='font-medium text-[12px] text-[var(--text-secondary)] tabular-nums'>
                    ${usage.current.toFixed(2)}
                  </span>
                  <span className='font-medium text-[12px] text-[var(--text-secondary)]'>/</span>
                  <span className='font-medium text-[12px] text-[var(--text-secondary)] tabular-nums'>
                    ${usage.limit.toFixed(2)}
                  </span>
                </>
              )}
            </div>
          </div>
          {badgeConfig.show && (
            <Badge variant={badgeConfig.variant} size='sm' className='-translate-y-[1px]'>
              {badgeConfig.label}
            </Badge>
          )}
        </div>

        {/* Pills row */}
        <div className='flex items-center gap-[4px]'>
          {Array.from({ length: pillCount }).map((_, i) => {
            const isFilled = i < filledPillsCount
            const baseColor = isFilled ? filledColor : USAGE_PILL_COLORS.UNFILLED

            const backgroundColor = baseColor
            let backgroundImage: string | undefined

            if (isHovered && wavePosition !== null) {
              const headIndex = Math.floor(wavePosition)
              const pillOffsetFromStart = i - startAnimationIndex

              if (pillOffsetFromStart >= 0 && pillOffsetFromStart < headIndex) {
                backgroundImage = `linear-gradient(to right, ${filledColor}, ${filledColor})`
              } else if (pillOffsetFromStart === headIndex) {
                const fillPercent = (wavePosition - headIndex) * 100
                backgroundImage = `linear-gradient(to right, ${filledColor} ${fillPercent}%, ${baseColor} ${fillPercent}%)`
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

      <UsageIndicatorContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        menuRef={contextMenuRef}
        onClose={closeContextMenu}
        menuItems={contextMenuItems}
      />
    </>
  )
}
