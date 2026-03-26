'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Info } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  Switch,
  Tooltip,
} from '@/components/emcn'
import { useSession, useSubscription } from '@/lib/auth/auth-client'
import { USAGE_THRESHOLDS } from '@/lib/billing/client/consts'
import { useSubscriptionUpgrade } from '@/lib/billing/client/upgrade'
import {
  ANNUAL_DISCOUNT_RATE,
  CREDIT_TIERS,
  DAILY_REFRESH_RATE,
  ON_DEMAND_UNLIMITED,
} from '@/lib/billing/constants'
import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
import {
  getDisplayPlanName,
  getPlanTierCredits,
  getPlanTierDollars,
  isEnterprise,
  isFree,
  isOrgPlan,
  isPaid,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import {
  getEffectiveSeats,
  hasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess,
} from '@/lib/billing/subscriptions/utils'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  CreditBalance,
  PlanCard,
} from '@/app/workspace/[workspaceId]/settings/components/subscription/components'
import {
  ENTERPRISE_PLAN_FEATURES,
  MAX_PLAN_FEATURES,
  PRO_PLAN_FEATURES,
  TEAM_INLINE_FEATURES,
} from '@/app/workspace/[workspaceId]/settings/components/subscription/plan-configs'
import {
  getSubscriptionPermissions,
  getVisiblePlans,
} from '@/app/workspace/[workspaceId]/settings/components/subscription/subscription-permissions'
import { UsageHeader } from '@/app/workspace/[workspaceId]/settings/components/usage-header/usage-header'
import {
  UsageLimit,
  type UsageLimitRef,
} from '@/app/workspace/[workspaceId]/settings/components/usage-limit'
import {
  useBillingUsageNotifications,
  useUpdateGeneralSetting,
} from '@/hooks/queries/general-settings'
import {
  useOrganizationBilling,
  useOrganizations,
  useUpdateOrganizationUsageLimit,
} from '@/hooks/queries/organization'
import {
  useOpenBillingPortal,
  useSubscriptionData,
  useUpdateUsageLimit,
  useUsageLimitData,
} from '@/hooks/queries/subscription'
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/queries/workspace'

const PRO_TIER = CREDIT_TIERS[0]
const MAX_TIER = CREDIT_TIERS[1]

const CONSTANTS = {
  TYPEFORM_ENTERPRISE_URL: 'https://form.typeform.com/to/jqCO12pF',
  INITIAL_TEAM_SEATS: 1,
} as const

type TargetPlan = 'pro' | 'team'

interface WorkspaceAdmin {
  userId: string
  email: string
  permissionType: string
}

function SubscriptionSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[20px]'>
      <div className='flex flex-col gap-[12px]'>
        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-[4px]'>
            <div className='flex h-[18px] items-center'>
              <Skeleton className='h-[12px] w-[40px] rounded-[4px]' />
            </div>
            <div className='flex h-[21px] items-center gap-[4px]'>
              <Skeleton className='h-[14px] w-[50px] rounded-[4px]' />
              <span className='font-medium text-[15px] text-[var(--text-primary)]'>/</span>
              <Skeleton className='h-[14px] w-[50px] rounded-[4px]' />
            </div>
          </div>
          <div className='flex flex-col items-end gap-[8px]'>
            <div className='flex w-[100px] items-center gap-[4px]'>
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className='h-[6px] flex-1 rounded-[2px]' />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className='flex flex-col gap-[10px]'>
        <div className='grid grid-cols-2 gap-[10px]'>
          {[0, 1].map((i) => (
            <article
              key={i}
              className='flex flex-1 flex-col overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'
            >
              <div className='flex items-center justify-between gap-[8px] px-[14px] py-[10px]'>
                <Skeleton className='h-[14px] w-[32px] rounded-[4px]' />
                <Skeleton className='h-[14px] w-[50px] rounded-[4px]' />
              </div>
              <div className='flex flex-1 flex-col gap-[18px] rounded-t-[8px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[16px]'>
                <ul className='flex flex-1 flex-col gap-[14px]'>
                  {[...Array(5)].map((_, j) => (
                    <li key={j} className='flex items-center gap-[8px]'>
                      <Skeleton className='h-[12px] w-[12px] flex-shrink-0 rounded-[4px]' />
                      <Skeleton className='h-[12px] w-[120px] rounded-[4px]' />
                    </li>
                  ))}
                </ul>
                <Skeleton className='h-[28px] w-full rounded-[5px]' />
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

const formatPlanName = getDisplayPlanName

interface CreditPlanCardProps {
  name: string
  credits: number
  dollars: number
  dailyRefresh: number
  isAnnual: boolean
  buttonText: string
  onButtonClick: () => void
  isCurrentPlan?: boolean
  onManagePlan?: () => void
  isTeamPlan?: boolean
  isCancelledAtPeriodEnd?: boolean
  features?: Array<{ icon: any; text: string }>
  isLegacyPlan?: boolean
}

function CreditPlanCard({
  name,
  credits,
  dollars,
  dailyRefresh,
  isAnnual,
  buttonText,
  onButtonClick,
  isCurrentPlan,
  onManagePlan,
  isTeamPlan,
  isCancelledAtPeriodEnd,
  features,
  isLegacyPlan,
}: CreditPlanCardProps) {
  const discountedMonthly = Math.round(dollars * (1 - ANNUAL_DISCOUNT_RATE))
  const perUnit = isTeamPlan ? '/seat' : ''

  return (
    <article className='flex flex-1 flex-col overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
      <div className='flex items-center justify-between gap-[8px] px-[14px] py-[10px]'>
        <span className='font-medium text-[14px] text-[var(--text-primary)]'>{name}</span>
        <div className='flex items-baseline gap-[4px]'>
          <span className='font-medium text-[14px] text-[var(--text-primary)]'>
            ${isAnnual ? discountedMonthly : dollars}
          </span>
          <span className='text-[12px] text-[var(--text-secondary)]'>{perUnit}/mo</span>
          {isAnnual && (
            <span className='ml-[2px] text-[11px] text-[var(--text-muted)] line-through'>
              ${dollars}
            </span>
          )}
        </div>
      </div>

      <div className='flex items-center gap-[12px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[10px]'>
        <div className='flex flex-col'>
          <span className='font-semibold text-[18px] text-[var(--text-primary)]'>
            {credits.toLocaleString()}
          </span>
          <span className='text-[11px] text-[var(--text-secondary)]'>credits/mo</span>
        </div>
        <div className='h-[28px] w-[1px] bg-[var(--border-1)]' />
        <div className='flex flex-col'>
          <span className='font-semibold text-[14px] text-[var(--text-primary)]'>
            +{dailyRefresh.toLocaleString()}
          </span>
          <span className='text-[11px] text-[var(--text-secondary)]'>daily refresh</span>
        </div>
      </div>

      {features && features.length > 0 && (
        <ul className='flex flex-col gap-[10px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[12px]'>
          {features.map((feature, idx) => (
            <li key={idx} className='flex items-center gap-[8px]'>
              <feature.icon className='h-[13px] w-[13px] flex-shrink-0 text-[var(--text-muted)]' />
              <span className='text-[12px] text-[var(--text-secondary)]'>{feature.text}</span>
            </li>
          ))}
        </ul>
      )}

      {isCurrentPlan && isLegacyPlan && (
        <div className='border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[8px]'>
          <Badge variant='amber' size='sm' dot>
            You are on an old version of this plan
          </Badge>
        </div>
      )}

      <div className='border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[14px]'>
        {isCurrentPlan ? (
          <Button onClick={onManagePlan} className='w-full' variant='default'>
            {isCancelledAtPeriodEnd ? 'Restore Subscription' : 'Manage plan'}
          </Button>
        ) : (
          <Button onClick={onButtonClick} className='w-full' variant='primary'>
            {buttonText}
          </Button>
        )}
      </div>
    </article>
  )
}

/**
 * Subscription management component
 */
export function Subscription() {
  const { data: session } = useSession()
  const { handleUpgrade } = useSubscriptionUpgrade()
  const betterAuthSubscription = useSubscription()
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canAdmin
  const logger = createLogger('Subscription')

  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    refetch: refetchSubscription,
  } = useSubscriptionData()
  const { data: usageLimitResponse, isLoading: isUsageLimitLoading } = useUsageLimitData()
  const { data: workspaceData, isLoading: isWorkspaceLoading } = useWorkspaceSettings(workspaceId)
  const updateWorkspaceMutation = useUpdateWorkspaceSettings()

  const { data: orgsData } = useOrganizations()
  const activeOrganization = orgsData?.activeOrganization
  const activeOrgId = activeOrganization?.id

  const { data: organizationBillingData, isLoading: isOrgBillingLoading } = useOrganizationBilling(
    activeOrgId || ''
  )

  const openBillingPortal = useOpenBillingPortal()
  const updateUserLimit = useUpdateUsageLimit()
  const updateOrgLimit = useUpdateOrganizationUsageLimit()
  const [isAnnual, setIsAnnual] = useState(false)
  const [teamModalOpen, setTeamModalOpen] = useState(false)
  const [managePlanModalOpen, setManagePlanModalOpen] = useState(false)
  const usageLimitRef = useRef<UsageLimitRef | null>(null)
  const hasInitializedInterval = useRef(false)

  const hasOrgPlan = isOrgPlan(subscriptionData?.data?.plan)
  const isLoading =
    isSubscriptionLoading ||
    isUsageLimitLoading ||
    isWorkspaceLoading ||
    (hasOrgPlan && isOrgBillingLoading)

  const isCancelledAtPeriodEnd = subscriptionData?.data?.cancelAtPeriodEnd === true

  const subscription = {
    isFree: isFree(subscriptionData?.data?.plan),
    isPro: isPro(subscriptionData?.data?.plan),
    isTeam: isTeam(subscriptionData?.data?.plan),
    isEnterprise: isEnterprise(subscriptionData?.data?.plan),
    isPaid:
      isPaid(subscriptionData?.data?.plan) &&
      hasPaidSubscriptionStatus(subscriptionData?.data?.status),
    plan: subscriptionData?.data?.plan || 'free',
    status: subscriptionData?.data?.status || 'inactive',
    seats: getEffectiveSeats(subscriptionData?.data),
  }

  const isLegacyPlan = subscription.plan === 'pro' || subscription.plan === 'team'

  const usage = {
    current: subscriptionData?.data?.usage?.current || 0,
    limit: subscriptionData?.data?.usage?.limit || 0,
    percentUsed: subscriptionData?.data?.usage?.percentUsed || 0,
  }

  const usageLimitData = {
    currentLimit: usageLimitResponse?.data?.currentLimit || 0,
    minimumLimit: usageLimitResponse?.data?.minimumLimit || getPlanTierDollars(subscription.plan),
  }

  const isBlocked = Boolean(subscriptionData?.data?.billingBlocked)
  const blockedReason = subscriptionData?.data?.billingBlockedReason as
    | 'payment_failed'
    | 'dispute'
    | null
  const isDispute = isBlocked && blockedReason === 'dispute'
  const isCritical = isBlocked || usage.percentUsed >= USAGE_THRESHOLDS.CRITICAL

  const billedAccountUserId = workspaceData?.settings?.workspace?.billedAccountUserId ?? null
  const workspaceAdmins: WorkspaceAdmin[] =
    workspaceData?.permissions?.users?.filter(
      (user: WorkspaceAdmin) => user.permissionType === 'admin'
    ) || []

  const updateWorkspaceSettings = async (updates: { billedAccountUserId?: string }) => {
    if (!workspaceId) return
    try {
      await updateWorkspaceMutation.mutateAsync({ workspaceId, ...updates })
    } catch (error) {
      logger.error('Error updating workspace settings:', { error })
      throw error
    }
  }

  useEffect(() => {
    if (!hasInitializedInterval.current && subscriptionData?.data?.billingInterval) {
      hasInitializedInterval.current = true
      setIsAnnual(subscriptionData.data.billingInterval === 'year')
    }
  }, [subscriptionData?.data?.billingInterval])

  const userRole = getUserRole(activeOrganization, session?.user?.email)
  const isTeamAdmin = ['owner', 'admin'].includes(userRole)

  const planIncludedAmount =
    (subscription.isTeam || subscription.isEnterprise) &&
    isTeamAdmin &&
    organizationBillingData?.data
      ? organizationBillingData.data.minimumBillingAmount
      : getPlanTierCredits(subscription.plan) / CREDIT_MULTIPLIER

  const effectiveUsageLimit =
    (subscription.isTeam || subscription.isEnterprise) &&
    isTeamAdmin &&
    organizationBillingData?.data
      ? organizationBillingData.data.totalUsageLimit
      : usageLimitData.currentLimit || usage.limit

  const isOnDemandActive =
    subscription.isPaid && planIncludedAmount > 0 && effectiveUsageLimit > planIncludedAmount

  const effectiveCurrentUsage =
    (subscription.isTeam || subscription.isEnterprise) &&
    organizationBillingData?.data?.totalCurrentUsage != null
      ? organizationBillingData.data.totalCurrentUsage
      : usage.current

  const canDisableOnDemand = isOnDemandActive && effectiveCurrentUsage <= planIncludedAmount

  const handleToggleOnDemand = useCallback(async () => {
    try {
      const isOrgContext =
        (subscription.isTeam || subscription.isEnterprise) && isTeamAdmin && activeOrgId

      if (isOnDemandActive) {
        if (!canDisableOnDemand) return
        if (isOrgContext) {
          await updateOrgLimit.mutateAsync({
            organizationId: activeOrgId!,
            limit: planIncludedAmount,
          })
        } else {
          await updateUserLimit.mutateAsync({ limit: planIncludedAmount })
        }
      } else {
        if (isOrgContext) {
          await updateOrgLimit.mutateAsync({
            organizationId: activeOrgId!,
            limit: ON_DEMAND_UNLIMITED,
          })
        } else {
          await updateUserLimit.mutateAsync({ limit: ON_DEMAND_UNLIMITED })
        }
      }
    } catch (error) {
      logger.error('Failed to toggle on-demand billing', { error })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutateAsync is stable in TanStack Query v5
  }, [
    isOnDemandActive,
    canDisableOnDemand,
    subscription.isTeam,
    subscription.isEnterprise,
    isTeamAdmin,
    activeOrgId,
    planIncludedAmount,
    logger,
  ])

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
    { isTeamAdmin, userRole: userRole || 'member' }
  )

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
    { isTeamAdmin, userRole: userRole || 'member' }
  )

  const showBadge =
    !permissions.isEnterpriseMember &&
    (permissions.showTeamMemberView ||
      subscription.isEnterprise ||
      isBlocked ||
      subscription.isFree)

  const getBadgeConfig = (): { text: string; variant: 'blue-secondary' | 'red' } => {
    if (permissions.isEnterpriseMember) return { text: '', variant: 'blue-secondary' }
    if (permissions.showTeamMemberView || subscription.isEnterprise)
      return { text: `${subscription.seats} seats`, variant: 'blue-secondary' }
    if (isDispute) return { text: 'Get Help', variant: 'red' }
    if (isBlocked) return { text: 'Fix Now', variant: 'red' }
    if (subscription.isFree) return { text: 'Upgrade', variant: 'blue-secondary' }
    return { text: '', variant: 'blue-secondary' }
  }
  const badgeConfig = getBadgeConfig()

  const hasUsablePaidAccess = subscription.isPaid
    ? hasUsableSubscriptionAccess(subscription.status, isBlocked)
    : false

  const onDemandState: 'hidden' | 'enable' | 'disable' = (() => {
    if (!hasUsablePaidAccess || !permissions.canEditUsageLimit) return 'hidden'
    return isOnDemandActive ? 'disable' : 'enable'
  })()

  const doUpgrade = useCallback(
    async (targetPlan: TargetPlan, creditTier: number, seats?: number) => {
      try {
        await handleUpgrade(targetPlan, {
          creditTier,
          annual: isAnnual,
          ...(seats ? { seats } : {}),
        })
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Unknown error occurred')
      }
    },
    [handleUpgrade, isAnnual]
  )

  const handleBadgeClick = useCallback(async () => {
    if (isDispute) {
      window.dispatchEvent(new CustomEvent('open-help-modal'))
      return
    }
    if (isBlocked) {
      const context = subscription.isTeam || subscription.isEnterprise ? 'organization' : 'user'
      openBillingPortal.mutate(
        {
          context,
          organizationId: activeOrgId,
          returnUrl: `${getBaseUrl()}/workspace?billing=updated`,
        },
        {
          onSuccess: (data) => {
            window.location.href = data.url
          },
          onError: (error) => {
            logger.error('Failed to open billing portal', { error })
            alert(error.message)
          },
        }
      )
      return
    }
    if (subscription.isFree) {
      doUpgrade('pro', PRO_TIER.credits)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openBillingPortal.mutate is stable in TanStack Query v5
  }, [
    isDispute,
    isBlocked,
    subscription.isFree,
    subscription.isTeam,
    subscription.isEnterprise,
    activeOrgId,
    doUpgrade,
    logger,
  ])

  const currentInterval: 'month' | 'year' =
    subscriptionData?.data?.billingInterval === 'year' ? 'year' : 'month'

  const handleSwitchInterval = useCallback(
    async (interval: 'month' | 'year') => {
      if (isLegacyPlan) {
        throw new Error(
          'Interval switching is not available on legacy plans. Please upgrade first.'
        )
      }
      const res = await fetch('/api/billing/switch-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPlanName: subscription.plan, interval }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to switch interval')
      await refetchSubscription()
    },
    [refetchSubscription, subscription.plan, isLegacyPlan]
  )

  const proDailyRefresh = Math.round(PRO_TIER.dollars * DAILY_REFRESH_RATE * CREDIT_MULTIPLIER)
  const maxDailyRefresh = Math.round(MAX_TIER.dollars * DAILY_REFRESH_RATE * CREDIT_MULTIPLIER)

  if (isLoading) return <SubscriptionSkeleton />

  const showUpgradePlans = permissions.showUpgradePlans
  const hasEnterprise = visiblePlans.includes('enterprise')
  const showTeamCard = visiblePlans.includes('pro') || visiblePlans.includes('team')

  return (
    <div className='flex h-full flex-col gap-[20px]'>
      {/* Current Plan & Usage Overview */}
      {permissions.canViewUsageInfo ? (
        <UsageHeader
          title={formatPlanName(subscription.plan)}
          showBadge={showBadge}
          badgeText={badgeConfig.text}
          badgeVariant={badgeConfig.variant}
          onBadgeClick={permissions.showTeamMemberView ? undefined : handleBadgeClick}
          seatsText={
            permissions.canManageTeam || subscription.isEnterprise
              ? `${subscription.seats} Seats`
              : undefined
          }
          onDemandState={onDemandState}
          onToggleOnDemand={
            onDemandState === 'enable'
              ? handleToggleOnDemand
              : onDemandState === 'disable' && canDisableOnDemand
                ? handleToggleOnDemand
                : undefined
          }
          current={
            (subscription.isTeam || subscription.isEnterprise) &&
            organizationBillingData?.data?.totalCurrentUsage != null
              ? organizationBillingData.data.totalCurrentUsage
              : usage.current
          }
          limit={
            subscription.isEnterprise || subscription.isTeam
              ? organizationBillingData?.data?.totalUsageLimit
              : !subscription.isFree &&
                  (permissions.canEditUsageLimit || permissions.showTeamMemberView)
                ? usage.current
                : usage.limit
          }
          isBlocked={isBlocked}
          progressValue={Math.min(usage.percentUsed, 100)}
          rightContent={
            !subscription.isFree &&
            (permissions.canEditUsageLimit || permissions.showTeamMemberView) ? (
              <UsageLimit
                ref={usageLimitRef}
                currentLimit={
                  (subscription.isTeam || subscription.isEnterprise) &&
                  isTeamAdmin &&
                  organizationBillingData?.data
                    ? organizationBillingData.data.totalUsageLimit
                    : usageLimitData.currentLimit || usage.limit
                }
                currentUsage={usage.current}
                canEdit={permissions.canEditUsageLimit}
                minimumLimit={
                  (subscription.isTeam || subscription.isEnterprise) &&
                  isTeamAdmin &&
                  organizationBillingData?.data
                    ? organizationBillingData.data.minimumBillingAmount
                    : usageLimitData.minimumLimit
                }
                context={
                  (subscription.isTeam || subscription.isEnterprise) && isTeamAdmin
                    ? 'organization'
                    : 'user'
                }
                organizationId={
                  (subscription.isTeam || subscription.isEnterprise) && isTeamAdmin
                    ? activeOrgId
                    : undefined
                }
                onLimitUpdated={() => logger.info('Usage limit updated')}
              />
            ) : undefined
          }
        />
      ) : (
        <div className='flex items-center'>
          <span className='font-medium text-[15px] text-[var(--text-primary)]'>
            {formatPlanName(subscription.plan)}
          </span>
        </div>
      )}

      {/* Upgrade Plans */}
      {showUpgradePlans && (
        <div className='flex flex-col gap-[12px]'>
          {/* Billing toggle */}
          <div className='flex items-center justify-start'>
            <div className='flex rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)] p-[2px]'>
              <button
                type='button'
                className={cn(
                  'rounded-[4px] px-[10px] py-[4px] font-medium text-[12px] transition-colors',
                  !isAnnual
                    ? 'bg-[var(--surface-3)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
                onClick={() => setIsAnnual(false)}
              >
                Monthly
              </button>
              <button
                type='button'
                className={cn(
                  'flex items-center gap-[4px] rounded-[4px] px-[10px] py-[4px] font-medium text-[12px] transition-colors',
                  isAnnual
                    ? 'bg-[var(--surface-3)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
                onClick={() => setIsAnnual(true)}
              >
                Annual
                <span className='rounded-[3px] bg-[#10b981] px-[4px] py-[1px] font-semibold text-[10px] text-white'>
                  -15%
                </span>
              </button>
            </div>
          </div>

          {/* Pro + Max cards -- hide the lower tier if user is on the higher one */}
          {(() => {
            const currentCredits = getPlanTierCredits(subscription.plan)
            const hasPaidPlan = isPro(subscription.plan) || isTeam(subscription.plan)
            const isLegacyTeam = subscription.plan === 'team'
            const isOnKnownTier =
              currentCredits === PRO_TIER.credits || currentCredits === MAX_TIER.credits
            const isOnProTier =
              hasPaidPlan &&
              !isLegacyTeam &&
              (currentCredits === PRO_TIER.credits || (!isOnKnownTier && !subscription.isTeam))
            const isOnMaxTier =
              hasPaidPlan &&
              (currentCredits === MAX_TIER.credits ||
                isLegacyTeam ||
                (!isOnKnownTier && subscription.isTeam))
            const wantsIntervalSwitch =
              hasPaidPlan && !isLegacyPlan && isAnnual !== (currentInterval === 'year')
            const isOnPro = isOnProTier && !wantsIntervalSwitch
            const isOnMax = isOnMaxTier && !wantsIntervalSwitch
            const showProCard = !isOnMaxTier

            return (
              <div className='grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-[10px]'>
                {showProCard && (
                  <CreditPlanCard
                    name='Pro'
                    credits={PRO_TIER.credits}
                    dollars={PRO_TIER.dollars}
                    dailyRefresh={proDailyRefresh}
                    isAnnual={isAnnual}
                    buttonText={
                      isOnPro
                        ? 'Manage plan'
                        : isOnProTier && wantsIntervalSwitch
                          ? `Switch to ${isAnnual ? 'Annual' : 'Monthly'}`
                          : 'Get started'
                    }
                    onButtonClick={
                      isOnPro
                        ? () => setManagePlanModalOpen(true)
                        : isOnProTier && wantsIntervalSwitch
                          ? () =>
                              handleSwitchInterval(isAnnual ? 'year' : 'month')
                                .then(() => setManagePlanModalOpen(false))
                                .catch((e) =>
                                  alert(
                                    e instanceof Error ? e.message : 'Failed to switch interval'
                                  )
                                )
                          : () => doUpgrade('pro', PRO_TIER.credits)
                    }
                    isCurrentPlan={isOnPro}
                    onManagePlan={() => setManagePlanModalOpen(true)}
                    isTeamPlan={subscription.isTeam}
                    isCancelledAtPeriodEnd={isCancelledAtPeriodEnd}
                    features={PRO_PLAN_FEATURES}
                    isLegacyPlan={isLegacyPlan && isOnProTier}
                  />
                )}
                <CreditPlanCard
                  name='Max'
                  credits={MAX_TIER.credits}
                  dollars={MAX_TIER.dollars}
                  dailyRefresh={maxDailyRefresh}
                  isAnnual={isAnnual}
                  buttonText={
                    isOnMax
                      ? 'Manage plan'
                      : isOnMaxTier && wantsIntervalSwitch
                        ? `Switch to ${isAnnual ? 'Annual' : 'Monthly'}`
                        : subscription.isTeam
                          ? 'Upgrade Team'
                          : subscription.isFree
                            ? 'Get started'
                            : 'Upgrade'
                  }
                  onButtonClick={
                    isOnMax
                      ? () => setManagePlanModalOpen(true)
                      : isOnMaxTier && wantsIntervalSwitch
                        ? () =>
                            handleSwitchInterval(isAnnual ? 'year' : 'month').catch((e) =>
                              alert(e instanceof Error ? e.message : 'Failed to switch interval')
                            )
                        : subscription.isPaid
                          ? async () => {
                              const planType = subscription.isTeam ? 'team' : 'pro'
                              try {
                                const res = await fetch('/api/billing/switch-plan', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    targetPlanName: `${planType}_${MAX_TIER.credits}`,
                                    interval: isAnnual ? 'year' : 'month',
                                  }),
                                })
                                const data = await res.json()
                                if (!res.ok) throw new Error(data?.error || 'Failed to upgrade')
                                await refetchSubscription()
                              } catch (e) {
                                alert(e instanceof Error ? e.message : 'Failed to upgrade')
                              }
                            }
                          : () => doUpgrade('pro', MAX_TIER.credits)
                  }
                  isCurrentPlan={isOnMax}
                  onManagePlan={() => setManagePlanModalOpen(true)}
                  isTeamPlan={subscription.isTeam}
                  isCancelledAtPeriodEnd={isCancelledAtPeriodEnd}
                  features={MAX_PLAN_FEATURES}
                  isLegacyPlan={isLegacyPlan && isOnMaxTier}
                />
                {hasEnterprise && (
                  <PlanCard
                    name='Enterprise'
                    price=''
                    features={ENTERPRISE_PLAN_FEATURES}
                    buttonText='Contact'
                    onButtonClick={() => window.open(CONSTANTS.TYPEFORM_ENTERPRISE_URL, '_blank')}
                  />
                )}
              </div>
            )
          })()}

          {/* Get For Team -- horizontal card */}
          {showTeamCard && (
            <PlanCard
              name='Get For Team'
              price=''
              features={TEAM_INLINE_FEATURES}
              buttonText='Get started'
              onButtonClick={() => setTeamModalOpen(true)}
              inlineButton
            />
          )}
        </div>
      )}

      {/* Team plan selection modal */}
      <TeamPlanModal
        open={teamModalOpen}
        onOpenChange={setTeamModalOpen}
        isAnnual={isAnnual}
        onConfirm={(creditTier, seats) => {
          setTeamModalOpen(false)
          doUpgrade('team', creditTier, seats)
        }}
      />

      {/* Manage current plan modal */}
      <ManagePlanModal
        open={managePlanModalOpen}
        onOpenChange={setManagePlanModalOpen}
        currentPlanCredits={getPlanTierCredits(subscription.plan)}
        currentPlanDollars={getPlanTierDollars(subscription.plan)}
        currentInterval={currentInterval}
        isTeamPlan={subscription.isTeam}
        onSwitchInterval={async (interval) => {
          await handleSwitchInterval(interval)
          setManagePlanModalOpen(false)
        }}
        onUpgradeToOtherTier={async () => {
          const isOnMax =
            getPlanTierCredits(subscription.plan) === MAX_TIER.credits ||
            subscription.plan === 'team'
          const targetTier = isOnMax ? PRO_TIER : MAX_TIER
          const planType = subscription.isTeam ? 'team' : 'pro'
          const targetPlanName = `${planType}_${targetTier.credits}`
          try {
            const res = await fetch('/api/billing/switch-plan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ targetPlanName }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.error || 'Failed to switch plan')
            await refetchSubscription()
            setManagePlanModalOpen(false)
          } catch (e) {
            alert(e instanceof Error ? e.message : 'Failed to switch plan')
          }
        }}
        onUpgradeToCurrentTier={async () => {
          const isOnMax =
            getPlanTierCredits(subscription.plan) === MAX_TIER.credits ||
            subscription.plan === 'team'
          const currentTier = isOnMax ? MAX_TIER : PRO_TIER
          const planType = subscription.isTeam ? 'team' : 'pro'
          const targetPlanName = `${planType}_${currentTier.credits}`
          try {
            const res = await fetch('/api/billing/switch-plan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ targetPlanName }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.error || 'Failed to migrate plan')
            await refetchSubscription()
            setManagePlanModalOpen(false)
          } catch (e) {
            alert(e instanceof Error ? e.message : 'Failed to migrate plan')
          }
        }}
        onGetForTeam={() => {
          setManagePlanModalOpen(false)
          if (subscription.isTeam) {
            window.location.href = `/workspace/${workspaceId}/settings/team`
          } else {
            setTeamModalOpen(true)
          }
        }}
        isCancelledAtPeriodEnd={isCancelledAtPeriodEnd}
        isLegacyPlan={isLegacyPlan}
        onCancel={async () => {
          setManagePlanModalOpen(false)
          if (!betterAuthSubscription.cancel) return
          try {
            const isOrgSub = (subscription.isTeam || subscription.isEnterprise) && activeOrgId
            const referenceId = isOrgSub ? activeOrgId : session?.user?.id || ''
            const returnUrl = getBaseUrl() + window.location.pathname
            await betterAuthSubscription.cancel({ returnUrl, referenceId })
          } catch (e) {
            logger.error('Failed to cancel subscription', { error: e })
            alert(e instanceof Error ? e.message : 'Failed to cancel subscription')
          }
        }}
        onRestore={async () => {
          if (!betterAuthSubscription.restore) return
          try {
            const isOrgSub = (subscription.isTeam || subscription.isEnterprise) && activeOrgId
            const referenceId = isOrgSub ? activeOrgId : session?.user?.id || ''
            await betterAuthSubscription.restore({ referenceId })
            await refetchSubscription()
            setManagePlanModalOpen(false)
          } catch (e) {
            logger.error('Failed to restore subscription', { error: e })
            alert(e instanceof Error ? e.message : 'Failed to restore subscription')
          }
        }}
      />

      {/* Billing details section */}
      {(subscription.isPaid || (!isLoading && isTeamAdmin)) && (
        <div className='flex flex-col'>
          {subscription.isPaid && permissions.canViewUsageInfo && (
            <div className='py-[2px]'>
              <CreditBalance
                balance={subscriptionData?.data?.creditBalance ?? 0}
                canPurchase={hasUsablePaidAccess && permissions.canEditUsageLimit}
                entityType={
                  subscription.isTeam || subscription.isEnterprise ? 'organization' : 'user'
                }
                isLoading={isLoading}
                onPurchaseComplete={() => refetchSubscription()}
              />
            </div>
          )}

          {subscription.isPaid &&
            subscriptionData?.data?.periodEnd &&
            !permissions.showTeamMemberView &&
            !permissions.isEnterpriseMember && (
              <div className='flex items-center justify-between border-[var(--border-1)] border-t pt-[16px]'>
                <Label>{isCancelledAtPeriodEnd ? 'Access Until' : 'Next Billing Date'}</Label>
                <span className='text-[13px] text-[var(--text-secondary)]'>
                  {new Date(subscriptionData.data.periodEnd).toLocaleDateString()}
                </span>
              </div>
            )}

          {subscription.isPaid && permissions.canViewUsageInfo && (
            <div className='border-[var(--border-1)] border-t pt-[16px]'>
              <BillingUsageNotificationsToggle />
            </div>
          )}

          {subscription.isPaid &&
            !permissions.showTeamMemberView &&
            !permissions.isEnterpriseMember && (
              <div className='flex items-center justify-between border-[var(--border-1)] border-t pt-[16px]'>
                <Label>Invoices</Label>
                <Button
                  variant='active'
                  size='sm'
                  disabled={openBillingPortal.isPending}
                  onClick={() => {
                    const portalWindow = window.open('', '_blank')
                    const context =
                      subscription.isTeam || subscription.isEnterprise ? 'organization' : 'user'
                    openBillingPortal.mutate(
                      {
                        context,
                        organizationId: activeOrgId,
                        returnUrl: window.location.href,
                      },
                      {
                        onSuccess: (data) => {
                          if (portalWindow) {
                            portalWindow.location.href = data.url
                          } else {
                            window.location.href = data.url
                          }
                        },
                        onError: (error) => {
                          portalWindow?.close()
                          logger.error('Failed to open billing portal', { error })
                          alert(error.message)
                        },
                      }
                    )
                  }}
                >
                  View Invoices
                </Button>
              </div>
            )}

          {!isLoading && isTeamAdmin && (
            <div className='flex items-center justify-between border-[var(--border-1)] border-t pt-[16px]'>
              <div className='flex items-center gap-[6px]'>
                <Label htmlFor='billed-account'>Billed Account</Label>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Info className='h-[12px] w-[12px] text-[var(--text-secondary)]' />
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <span>Usage from this workspace will be billed to this account</span>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
              {workspaceAdmins.length === 0 ? (
                <div className='rounded-[6px] border border-[var(--border)] border-dashed px-[12px] py-[6px] text-[13px] text-[var(--text-muted)]'>
                  No admins available
                </div>
              ) : (
                <div className='w-[200px]'>
                  <Combobox
                    size='sm'
                    align='end'
                    dropdownWidth={200}
                    value={billedAccountUserId || ''}
                    onChange={async (value: string) => {
                      if (value && value !== billedAccountUserId) {
                        try {
                          await updateWorkspaceSettings({ billedAccountUserId: value })
                        } catch {
                          /* logged above */
                        }
                      }
                    }}
                    disabled={!canManageWorkspaceKeys || updateWorkspaceMutation.isPending}
                    placeholder='Select admin'
                    options={workspaceAdmins.map((admin) => ({
                      label: admin.email,
                      value: admin.userId,
                    }))}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface TeamPlanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isAnnual: boolean
  onConfirm: (creditTier: number, seats: number) => void
}

function TeamPlanModal({ open, onOpenChange, isAnnual, onConfirm }: TeamPlanModalProps) {
  const [selectedTier, setSelectedTier] = useState<number>(PRO_TIER.credits)
  const [selectedSeats, setSelectedSeats] = useState(1)

  useEffect(() => {
    if (open) {
      setSelectedTier(PRO_TIER.credits)
      setSelectedSeats(1)
    }
  }, [open])

  const tier = CREDIT_TIERS.find((t) => t.credits === selectedTier) ?? PRO_TIER
  const monthlyCostPerSeat = tier.dollars
  const totalMonthly = monthlyCostPerSeat * selectedSeats
  const annualTotal = Math.round(totalMonthly * 12 * (1 - ANNUAL_DISCOUNT_RATE))
  const discountedMonthlyTotal = Math.round(annualTotal / 12)

  const seatOptions: ComboboxOption[] = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50].map((num) => ({
    value: num.toString(),
    label: `${num} ${num === 1 ? 'seat' : 'seats'}`,
  }))

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>Get For Team</ModalHeader>
        <ModalBody>
          <p className='text-[var(--text-secondary)]'>
            Choose a plan and number of seats for your team. Credits are pooled across all members.
          </p>

          {/* Plan toggle */}
          <div className='mt-[16px] flex flex-col gap-[4px]'>
            <Label className='text-[13px]'>Plan</Label>
            <div className='flex gap-[8px]'>
              <button
                type='button'
                className={cn(
                  'flex-1 rounded-[6px] border px-[12px] py-[10px] text-left transition-colors',
                  selectedTier === PRO_TIER.credits
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                    : 'border-[var(--border-1)] hover:border-[var(--border-2)]'
                )}
                onClick={() => setSelectedTier(PRO_TIER.credits)}
              >
                <span className='block font-medium text-[13px] text-[var(--text-primary)]'>
                  Pro
                </span>
                <span className='block text-[12px] text-[var(--text-secondary)]'>
                  {PRO_TIER.credits.toLocaleString()} credits/seat &middot; ${PRO_TIER.dollars}
                  /seat/mo
                </span>
              </button>
              <button
                type='button'
                className={cn(
                  'flex-1 rounded-[6px] border px-[12px] py-[10px] text-left transition-colors',
                  selectedTier === MAX_TIER.credits
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                    : 'border-[var(--border-1)] hover:border-[var(--border-2)]'
                )}
                onClick={() => setSelectedTier(MAX_TIER.credits)}
              >
                <span className='block font-medium text-[13px] text-[var(--text-primary)]'>
                  Max
                </span>
                <span className='block text-[12px] text-[var(--text-secondary)]'>
                  {MAX_TIER.credits.toLocaleString()} credits/seat &middot; ${MAX_TIER.dollars}
                  /seat/mo
                </span>
              </button>
            </div>
          </div>

          {/* Seat selector */}
          <div className='mt-[16px] flex flex-col gap-[4px]'>
            <Label className='text-[13px]'>Seats</Label>
            <Combobox
              options={seatOptions}
              value={selectedSeats > 0 ? selectedSeats.toString() : ''}
              onChange={(value) => {
                const num = Number.parseInt(value, 10)
                if (!Number.isNaN(num) && num > 0) setSelectedSeats(num)
              }}
              placeholder='Select seats'
              editable
            />
          </div>

          {/* Cost summary */}
          <div className='mt-[16px] rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-4)] px-[12px] py-[10px]'>
            <div className='flex justify-between text-[13px]'>
              <span className='text-[var(--text-muted)]'>
                {selectedSeats} {selectedSeats === 1 ? 'seat' : 'seats'} &times; $
                {monthlyCostPerSeat}/mo
              </span>
              <span className='font-medium text-[var(--text-primary)]'>
                {isAnnual ? `$${discountedMonthlyTotal}/mo` : `$${totalMonthly}/mo`}
              </span>
            </div>
            {isAnnual && (
              <div className='mt-[4px] flex justify-between text-[12px]'>
                <span className='text-[var(--text-muted)]'>Annual total</span>
                <span className='text-[var(--text-secondary)]'>
                  ${annualTotal}/yr
                  <span className='ml-[4px] text-[var(--text-muted)] line-through'>
                    ${totalMonthly * 12}
                  </span>
                </span>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant='primary'
            onClick={() => onConfirm(selectedTier, selectedSeats)}
            disabled={selectedSeats < 1}
          >
            Get started
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

interface ManagePlanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPlanCredits: number
  currentPlanDollars: number
  currentInterval: 'month' | 'year'
  isTeamPlan: boolean
  isCancelledAtPeriodEnd: boolean
  isLegacyPlan: boolean
  onSwitchInterval: (interval: 'month' | 'year') => Promise<void>
  onUpgradeToOtherTier: () => void
  onUpgradeToCurrentTier: () => void
  onGetForTeam: () => void
  onCancel: () => void
  onRestore: () => void
}

function ManagePlanModal({
  open,
  onOpenChange,
  currentPlanCredits,
  currentPlanDollars,
  currentInterval,
  isTeamPlan,
  isCancelledAtPeriodEnd,
  isLegacyPlan,
  onSwitchInterval,
  onUpgradeToOtherTier,
  onUpgradeToCurrentTier,
  onGetForTeam,
  onCancel,
  onRestore,
}: ManagePlanModalProps) {
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  const isOnMax = currentPlanCredits === MAX_TIER.credits || (isLegacyPlan && isTeamPlan)
  const currentTier = isOnMax ? MAX_TIER : PRO_TIER
  const otherTier = isOnMax ? PRO_TIER : MAX_TIER
  const isUpgrade = otherTier.dollars > currentTier.dollars
  const targetInterval = currentInterval === 'month' ? 'year' : 'month'

  const perUnit = isTeamPlan ? '/seat' : ''
  const actualAnnualTotal = Math.round(currentPlanDollars * 12 * (1 - ANNUAL_DISCOUNT_RATE))
  const actualDiscountedMonthly = Math.round(actualAnnualTotal / 12)

  const handleSwitchInterval = async () => {
    setIsSwitching(true)
    setError(null)
    try {
      await onSwitchInterval(targetInterval)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch interval')
    } finally {
      setIsSwitching(false)
    }
  }

  const actions = [
    ...(!isLegacyPlan
      ? [
          {
            title:
              currentInterval === 'month'
                ? 'Switch to annual billing'
                : 'Switch to monthly billing',
            description:
              currentInterval === 'month'
                ? `$${actualDiscountedMonthly}/mo${perUnit} ($${actualAnnualTotal}/yr${perUnit}) — save 15%`
                : `$${currentTier.dollars}/mo${perUnit} — billed monthly`,
            buttonText: isSwitching ? 'Switching...' : 'Switch',
            onClick: handleSwitchInterval,
            disabled: isSwitching,
          },
        ]
      : [
          {
            title: `Upgrade to current ${currentTier.name} plan`,
            description: `${currentTier.credits.toLocaleString()} credits/mo · $${currentTier.dollars}/mo${perUnit} — unlocks annual billing`,
            buttonText: isSwitching ? 'Upgrading...' : 'Upgrade',
            onClick: onUpgradeToCurrentTier,
            disabled: isSwitching,
          },
        ]),
    {
      title: isUpgrade ? `Upgrade to ${otherTier.name}` : `Switch to ${otherTier.name}`,
      description: `${otherTier.credits.toLocaleString()} credits/mo · $${otherTier.dollars}/mo${perUnit}`,
      buttonText: isUpgrade ? 'Upgrade' : 'Switch',
      onClick: onUpgradeToOtherTier,
    },
    {
      title: isTeamPlan ? 'Manage Team' : 'Get for Team',
      description: isTeamPlan
        ? 'Manage seats, members, and permissions'
        : 'Shared pool, access control, higher limits',
      buttonText: isTeamPlan ? 'Manage' : 'Get started',
      onClick: onGetForTeam,
    },
  ]

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>
          Manage {currentTier.name} Plan{isTeamPlan ? ' (Team)' : ''}
        </ModalHeader>
        <ModalBody>
          <p className='text-[var(--text-secondary)]'>
            You're on the{' '}
            <span className='font-medium text-[var(--text-primary)]'>{currentTier.name}</span> plan
            {isTeamPlan ? ' for your team' : ''}, billed{' '}
            {currentInterval === 'month'
              ? `$${currentPlanDollars}/mo${perUnit}`
              : `$${actualAnnualTotal}/yr${perUnit} ($${actualDiscountedMonthly}/mo${perUnit})`}
            .
          </p>

          {isLegacyPlan && (
            <Badge variant='amber' size='lg' dot className='mt-[8px]'>
              You're on an older version of this plan
            </Badge>
          )}

          <div className='mt-[16px] flex flex-col'>
            {actions.map((action, i) => (
              <div
                key={action.title}
                className={cn(
                  'flex items-center justify-between py-[12px]',
                  i > 0 && 'border-[var(--border-1)] border-t'
                )}
              >
                <div className='min-w-0 flex-1'>
                  <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                    {action.title}
                  </span>
                  <span className='block text-[12px] text-[var(--text-secondary)]'>
                    {action.description}
                  </span>
                </div>
                <Button
                  variant='primary'
                  className='ml-[12px] shrink-0'
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.buttonText}
                </Button>
              </div>
            ))}
          </div>

          {error && (
            <span className='mt-[4px] block text-[12px] text-[var(--text-error)]'>{error}</span>
          )}
        </ModalBody>
        <ModalFooter>
          {isCancelledAtPeriodEnd ? (
            <>
              <Button variant='default' onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant='primary' onClick={onRestore}>
                Restore Subscription
              </Button>
            </>
          ) : (
            <>
              <Button variant='destructive' onClick={onCancel}>
                Cancel subscription
              </Button>
              <Button variant='default' onClick={() => onOpenChange(false)}>
                Keep Subscription
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

function BillingUsageNotificationsToggle() {
  const enabled = useBillingUsageNotifications()
  const updateSetting = useUpdateGeneralSetting()
  const isLoading = updateSetting.isPending

  return (
    <div className='flex items-center justify-between'>
      <div className='flex flex-col gap-[4px]'>
        <Label htmlFor='usage-notifications'>Usage notifications</Label>
        <span className='text-[13px] text-[var(--text-muted)]'>
          Email me when I reach 80% usage
        </span>
      </div>
      <Switch
        id='usage-notifications'
        checked={!!enabled}
        disabled={isLoading}
        onCheckedChange={(v: boolean) => {
          if (v !== enabled) {
            updateSetting.mutate({ key: 'billingUsageNotificationsEnabled', value: v })
          }
        }}
      />
    </div>
  )
}
