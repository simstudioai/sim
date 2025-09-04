'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Progress, Skeleton } from '@/components/ui'
import { useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import {
  CancelSubscription,
  PlanCard,
  UsageLimit,
  type UsageLimitRef,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/components'
import {
  ENTERPRISE_PLAN_FEATURES,
  PRO_PLAN_FEATURES,
  TEAM_PLAN_FEATURES,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/plan-configs'
import {
  getSubscriptionPermissions,
  getVisiblePlans,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/subscription-permissions'
import { useOrganizationStore } from '@/stores/organization'
import { useSubscriptionStore } from '@/stores/subscription/store'

// Logger
const logger = createLogger('Subscription')

// Constants
const CONSTANTS = {
  UPGRADE_ERROR_TIMEOUT: 3000, // 3 seconds
  TYPEFORM_ENTERPRISE_URL: 'https://form.typeform.com/to/jqCO12pF',
  PRO_PRICE: '$20',
  TEAM_PRICE: '$40',
  INITIAL_TEAM_SEATS: 1,
} as const

// Styles
const STYLES = {
  GRADIENT_BADGE:
    'gradient-text h-[1.125rem] rounded-[6px] border-gradient-primary/20 bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary px-2 py-0 font-medium text-xs cursor-pointer',
} as const

// Types
type TargetPlan = 'pro' | 'team'

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
}

/**
 * Skeleton component for subscription loading state
 */
function SubscriptionSkeleton() {
  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-2'>
        {/* Current Plan skeleton - matches usage indicator style */}
        <div className='mb-2'>
          <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-5 w-16' />
                  <Skeleton className='h-[1.125rem] w-14 rounded-[6px]' />
                </div>
                <div className='flex items-center gap-1 text-xs tabular-nums'>
                  <Skeleton className='h-4 w-8' />
                  <span className='text-muted-foreground'>/</span>
                  <Skeleton className='h-4 w-8' />
                </div>
              </div>
              <Skeleton className='h-2 w-full rounded' />
            </div>
          </div>
        </div>

        {/* Plan cards skeleton */}
        <div className='flex flex-col gap-2'>
          {/* Pro and Team skeleton grid */}
          <div className='grid grid-cols-2 gap-2'>
            {/* Pro Plan Card Skeleton */}
            <div className='flex flex-col rounded-[8px] border p-4'>
              <div className='mb-4'>
                <Skeleton className='mb-2 h-5 w-8' />
                <div className='flex items-baseline'>
                  <Skeleton className='h-6 w-10' />
                  <Skeleton className='ml-1 h-3 w-12' />
                </div>
              </div>
              <div className='mb-4 flex-1 space-y-2'>
                <div className='flex items-start gap-2'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-20' />
                </div>
                <div className='flex items-start gap-2'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-24' />
                </div>
                <div className='flex items-start gap-2'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-16' />
                </div>
                <div className='flex items-start gap-2'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-20' />
                </div>
              </div>
              <Skeleton className='h-9 w-full rounded-[8px]' />
            </div>

            {/* Team Plan Card Skeleton */}
            <div className='flex flex-col rounded-[8px] border p-4'>
              <div className='mb-4'>
                <Skeleton className='mb-2 h-5 w-10' />
                <div className='flex items-baseline'>
                  <Skeleton className='h-6 w-10' />
                  <Skeleton className='ml-1 h-3 w-12' />
                </div>
              </div>
              <div className='mb-4 flex-1 space-y-2'>
                <div className='flex items-start gap-2'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-24' />
                </div>
                <div className='flex items-start gap-2'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-20' />
                </div>
                <div className='flex items-start gap-2'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-16' />
                </div>
                <div className='flex items-start gap-2'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-28' />
                </div>
              </div>
              <Skeleton className='h-9 w-full rounded-[8px]' />
            </div>
          </div>

          {/* Enterprise skeleton - horizontal layout */}
          <div className='flex items-center justify-between rounded-[8px] border p-4'>
            <div>
              <Skeleton className='mb-2 h-5 w-20' />
              <Skeleton className='mb-3 h-3 w-64' />
              <div className='flex items-center gap-4'>
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-16' />
                </div>
                <div className='h-4 w-px bg-border' />
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-20' />
                </div>
                <div className='h-4 w-px bg-border' />
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-20' />
                </div>
              </div>
            </div>
            <Skeleton className='h-9 w-16 rounded-[8px]' />
          </div>
        </div>
      </div>
    </div>
  )
}

// Utility functions
const formatPlanName = (plan: string): string => plan.charAt(0).toUpperCase() + plan.slice(1)

/**
 * Subscription management component
 * Handles plan display, upgrades, and billing management
 */
export function Subscription({ onOpenChange }: SubscriptionProps) {
  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()

  const {
    isLoading,
    getSubscriptionStatus,
    getUsage,
    getBillingStatus,
    usageLimitData,
    subscriptionData,
  } = useSubscriptionStore()

  const { activeOrganization, organizationBillingData, loadOrganizationBillingData, getUserRole } =
    useOrganizationStore()

  const [upgradeError, setUpgradeError] = useState<'pro' | 'team' | null>(null)
  const usageLimitRef = useRef<UsageLimitRef | null>(null)

  // Get real subscription data from store
  const subscription = getSubscriptionStatus()
  const usage = getUsage()
  const billingStatus = getBillingStatus()
  const activeOrgId = activeOrganization?.id

  useEffect(() => {
    if (subscription.isTeam && activeOrgId) {
      loadOrganizationBillingData(activeOrgId)
    }
  }, [activeOrgId, subscription.isTeam, loadOrganizationBillingData])

  // Auto-clear upgrade error
  useEffect(() => {
    if (upgradeError) {
      const timer = setTimeout(() => {
        setUpgradeError(null)
      }, CONSTANTS.UPGRADE_ERROR_TIMEOUT)
      return () => clearTimeout(timer)
    }
  }, [upgradeError])

  // User role and permissions
  const userRole = getUserRole(session?.user?.email)
  const isTeamAdmin = ['owner', 'admin'].includes(userRole)

  // Get permissions based on subscription state and user role
  const permissions = getSubscriptionPermissions(
    {
      isFree: subscription.isFree,
      isPro: subscription.isPro,
      isTeam: subscription.isTeam,
      isEnterprise: subscription.isEnterprise,
      isPaid: subscription.isPaid,
      plan: subscription.plan || 'free',
      status: subscription.status || 'inactive',
    },
    {
      isTeamAdmin,
      userRole: userRole || 'member',
    }
  )

  // Get visible plans based on current subscription
  const visiblePlans = getVisiblePlans(
    {
      isFree: subscription.isFree,
      isPro: subscription.isPro,
      isTeam: subscription.isTeam,
      isEnterprise: subscription.isEnterprise,
      isPaid: subscription.isPaid,
      plan: subscription.plan || 'free',
      status: subscription.status || 'inactive',
    },
    {
      isTeamAdmin,
      userRole: userRole || 'member',
    }
  )

  // UI state computed values
  const showBadge = permissions.canEditUsageLimit && !permissions.showTeamMemberView
  const badgeText = subscription.isFree ? 'Upgrade' : 'Add'

  const handleBadgeClick = () => {
    if (subscription.isFree) {
      handleUpgrade('pro')
    } else if (permissions.canEditUsageLimit && usageLimitRef.current) {
      usageLimitRef.current.startEdit()
    }
  }

  const handleUpgrade = useCallback(
    async (targetPlan: TargetPlan) => {
      if (!session?.user?.id) return

      const { subscriptionData } = useSubscriptionStore.getState()
      const currentSubscriptionId = subscriptionData?.stripeSubscriptionId

      let referenceId = session.user.id
      if (subscription.isTeam && activeOrgId) {
        referenceId = activeOrgId
      }

      const currentUrl = `${window.location.origin}${window.location.pathname}`

      try {
        const upgradeParams = {
          plan: targetPlan,
          referenceId,
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          ...(targetPlan === 'team' && { seats: CONSTANTS.INITIAL_TEAM_SEATS }),
        } as const

        // Add subscriptionId for existing subscriptions to ensure proper plan switching
        const finalParams = currentSubscriptionId
          ? { ...upgradeParams, subscriptionId: currentSubscriptionId }
          : upgradeParams

        logger.info(
          currentSubscriptionId ? 'Upgrading existing subscription' : 'Creating new subscription',
          {
            targetPlan,
            currentSubscriptionId,
            referenceId,
          }
        )

        await betterAuthSubscription.upgrade(finalParams)
      } catch (error) {
        logger.error('Failed to initiate subscription upgrade:', error)
        alert('Failed to initiate upgrade. Please try again or contact support.')
      }
    },
    [session?.user?.id, subscription.isTeam, activeOrgId, betterAuthSubscription]
  )

  const renderPlanCard = useCallback(
    (planType: 'pro' | 'team' | 'enterprise', layout: 'vertical' | 'horizontal' = 'vertical') => {
      const handleContactEnterprise = () => window.open(CONSTANTS.TYPEFORM_ENTERPRISE_URL, '_blank')

      switch (planType) {
        case 'pro':
          return (
            <PlanCard
              key='pro'
              name='Pro'
              price={CONSTANTS.PRO_PRICE}
              priceSubtext='/month'
              features={PRO_PLAN_FEATURES}
              buttonText={subscription.isFree ? 'Upgrade' : 'Upgrade to Pro'}
              onButtonClick={() => handleUpgrade('pro')}
              isError={upgradeError === 'pro'}
              layout={layout}
            />
          )

        case 'team':
          return (
            <PlanCard
              key='team'
              name='Team'
              price={CONSTANTS.TEAM_PRICE}
              priceSubtext='/month'
              features={TEAM_PLAN_FEATURES}
              buttonText={subscription.isFree ? 'Upgrade' : 'Upgrade to Team'}
              onButtonClick={() => handleUpgrade('team')}
              isError={upgradeError === 'team'}
              layout={layout}
            />
          )

        case 'enterprise':
          return (
            <PlanCard
              key='enterprise'
              name='Enterprise'
              price={<span className='font-semibold text-xl'>Custom</span>}
              priceSubtext={
                layout === 'horizontal'
                  ? 'Custom solutions tailored to your enterprise needs'
                  : undefined
              }
              features={ENTERPRISE_PLAN_FEATURES}
              buttonText='Contact'
              onButtonClick={handleContactEnterprise}
              layout={layout}
            />
          )

        default:
          return null
      }
    },
    [subscription.isFree, upgradeError, handleUpgrade]
  )

  if (isLoading) {
    return <SubscriptionSkeleton />
  }

  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-2'>
        {/* Current Plan & Usage Overview - Styled like usage-indicator */}
        <div className='mb-2'>
          <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
            <div className='space-y-2'>
              {/* Plan and usage info */}
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <span
                    className={cn(
                      'font-medium text-sm',
                      subscription.isFree
                        ? 'text-foreground'
                        : 'gradient-text bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary'
                    )}
                  >
                    {formatPlanName(subscription.plan)}
                  </span>
                  {showBadge && (
                    <Badge
                      className={STYLES.GRADIENT_BADGE}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleBadgeClick()
                      }}
                    >
                      {badgeText}
                    </Badge>
                  )}
                  {/* Team seats info for admins */}
                  {permissions.canManageTeam && (
                    <span className='text-muted-foreground text-xs'>
                      ({organizationBillingData?.totalSeats || subscription.seats || 1} seats)
                    </span>
                  )}
                </div>
                <div className='flex items-center gap-1 text-xs tabular-nums'>
                  <span className='text-muted-foreground'>${usage.current.toFixed(2)}</span>
                  <span className='text-muted-foreground'>/</span>
                  {!subscription.isFree &&
                  (permissions.canEditUsageLimit ||
                    permissions.showTeamMemberView ||
                    subscription.isEnterprise) ? (
                    <UsageLimit
                      ref={usageLimitRef}
                      currentLimit={usageLimitData?.currentLimit || usage.limit}
                      currentUsage={usage.current}
                      canEdit={permissions.canEditUsageLimit && !subscription.isEnterprise}
                      minimumLimit={usageLimitData?.minimumLimit || (subscription.isPro ? 20 : 40)}
                    />
                  ) : (
                    <span className='text-muted-foreground'>${usage.limit}</span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <Progress value={Math.min(usage.percentUsed, 100)} className='h-2' />
            </div>
          </div>
        </div>

        {/* Team Member Notice */}
        {permissions.showTeamMemberView && (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>
              Contact your team admin to increase limits
            </p>
          </div>
        )}

        {/* Upgrade Plans */}
        {permissions.showUpgradePlans && (
          <div className='flex flex-col gap-2'>
            {/* Render plans based on what should be visible */}
            {(() => {
              const totalPlans = visiblePlans.length
              const hasEnterprise = visiblePlans.includes('enterprise')

              // Special handling for Pro users - show team and enterprise side by side
              if (subscription.isPro && totalPlans === 2) {
                return (
                  <div className='grid grid-cols-2 gap-2'>
                    {visiblePlans.map((plan) => renderPlanCard(plan, 'vertical'))}
                  </div>
                )
              }

              // Default behavior for other users
              const otherPlans = visiblePlans.filter((p) => p !== 'enterprise')

              // Layout logic:
              // Free users (3 plans): Pro and Team vertical in grid, Enterprise horizontal below
              // Team admins (1 plan): Enterprise horizontal
              const enterpriseLayout =
                totalPlans === 1 || totalPlans === 3 ? 'horizontal' : 'vertical'

              return (
                <>
                  {otherPlans.length > 0 && (
                    <div
                      className={cn(
                        'grid gap-2',
                        otherPlans.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                      )}
                    >
                      {otherPlans.map((plan) => renderPlanCard(plan, 'vertical'))}
                    </div>
                  )}

                  {/* Enterprise plan */}
                  {hasEnterprise && renderPlanCard('enterprise', enterpriseLayout)}
                </>
              )
            })()}
          </div>
        )}

        {subscription.isEnterprise && (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>
              Contact enterprise for support usage limit changes
            </p>
          </div>
        )}

        {/* Cancel Subscription */}
        {permissions.canCancelSubscription && (
          <div className='mt-2'>
            <CancelSubscription
              subscription={{
                plan: subscription.plan,
                status: subscription.status,
                isPaid: subscription.isPaid,
              }}
              subscriptionData={{
                periodEnd: subscriptionData?.periodEnd || null,
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
