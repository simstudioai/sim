'use client'
import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { billingSwitchPlanContract } from '@/lib/api/contracts/subscription'
import { useSession, useSubscription } from '@/lib/auth/auth-client'
import { useSubscriptionUpgrade } from '@/lib/billing/client/upgrade'
import { CREDIT_TIERS, ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
import {
  getPlanTierCredits,
  getPlanTierDollars,
  isEnterprise,
  isFree,
  isPaid,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import {
  getEffectiveSeats,
  hasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess,
} from '@/lib/billing/subscriptions/utils'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { UsageLimitRef } from '@/app/workspace/[workspaceId]/settings/components/usage-limit'
import type { SubscriptionPermissions } from '@/app/workspace/[workspaceId]/upgrade/subscription-permissions'
import { getSubscriptionPermissions } from '@/app/workspace/[workspaceId]/upgrade/subscription-permissions'
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

const logger = createLogger('UpgradeState')

type TargetPlan = 'pro' | 'team'

export interface UpgradeStateWorkspaceAdmin {
  userId: string
  email: string
  permissionType: string
}

export interface UpgradeState {
  isLoading: boolean
  isAnnual: boolean
  setIsAnnual: (v: boolean) => void
  subscription: {
    isFree: boolean
    isPro: boolean
    isTeam: boolean
    isEnterprise: boolean
    isPaid: boolean
    isOrgScoped: boolean
    plan: string
    status: string
    seats: number
  }
  isLegacyPlan: boolean
  isCancelledAtPeriodEnd: boolean
  currentInterval: 'month' | 'year'
  permissions: SubscriptionPermissions
  showUpgradePlans: boolean
  proTier: { credits: number; dollars: number; name: string }
  maxTier: { credits: number; dollars: number; name: string }
  isOnPro: boolean
  isOnMax: boolean
  isOnProTier: boolean
  isOnMaxTier: boolean
  wantsIntervalSwitch: boolean
  usage: { current: number; limit: number; percentUsed: number }
  usageLimitData: { currentLimit: number; minimumLimit: number }
  organizationBillingData: ReturnType<typeof useOrganizationBilling>['data']
  billingOrganizationId: string | null
  isTeamAdmin: boolean
  shouldUseOrganizationBillingContext: boolean
  onDemandState: 'hidden' | 'enable' | 'disable'
  canDisableOnDemand: boolean
  hasUsablePaidAccess: boolean
  isBlocked: boolean
  showBadge: boolean
  badgeConfig: { text: string; variant: 'blue-secondary' | 'red' }
  creditBalance: number
  periodEnd: string | null
  workspaceId: string
  isGrandfatheredSharedWorkspace: boolean
  workspaceAdmins: UpgradeStateWorkspaceAdmin[]
  billedAccountUserId: string | null
  canManageWorkspaceKeys: boolean
  updateWorkspaceSettings: (updates: { billedAccountUserId?: string }) => Promise<void>
  isUpdatingWorkspace: boolean
  isBillingPortalPending: boolean
  managePlanModalOpen: boolean
  setManagePlanModalOpen: (open: boolean) => void
  usageLimitRef: RefObject<UsageLimitRef | null>
  doUpgrade: (targetPlan: 'pro' | 'team', creditTier: number, seats?: number) => Promise<void>
  handleSwitchInterval: (interval: 'month' | 'year') => Promise<void>
  handleToggleOnDemand: () => Promise<void>
  handleBadgeClick: () => Promise<void>
  onCancel: () => Promise<void>
  onRestore: () => Promise<void>
  openBillingPortalWindow: () => void
  upgradeOrSwitchToMax: () => Promise<void>
  onUpgradeToOtherTier: () => Promise<void>
  onUpgradeToCurrentTier: () => Promise<void>
  refetchSubscription: () => Promise<unknown>
}

/**
 * Subscription / billing state hook for the Upgrade page. Reproduces the
 * derived state and handlers from the Subscription settings component.
 */
export function useUpgradeState(): UpgradeState {
  const { data: session } = useSession()
  const { handleUpgrade } = useSubscriptionUpgrade()
  const betterAuthSubscription = useSubscription()
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canAdmin

  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    refetch: refetchSubscription,
  } = useSubscriptionData({ includeOrg: true })
  const { data: usageLimitResponse, isLoading: isUsageLimitLoading } = useUsageLimitData()
  const { data: workspaceData, isLoading: isWorkspaceLoading } = useWorkspaceSettings(workspaceId)
  const updateWorkspaceMutation = useUpdateWorkspaceSettings()

  const { data: orgsData } = useOrganizations()
  const activeOrganization = orgsData?.activeOrganization
  const activeOrgId = activeOrganization?.id
  const workspaceOrganizationId = workspaceData?.settings?.workspace?.organizationId ?? null
  const billingOrganizationId =
    workspaceOrganizationId ?? subscriptionData?.data?.organization?.id ?? activeOrgId ?? null

  const { data: organizationBillingData, isLoading: isOrgBillingLoading } = useOrganizationBilling(
    billingOrganizationId || ''
  )

  const openBillingPortal = useOpenBillingPortal()
  const updateUserLimit = useUpdateUsageLimit()
  const updateOrgLimit = useUpdateOrganizationUsageLimit()
  const [isAnnual, setIsAnnual] = useState(true)
  const [managePlanModalOpen, setManagePlanModalOpen] = useState(false)
  const usageLimitRef = useRef<UsageLimitRef | null>(null)
  const hasInitializedInterval = useRef(false)

  const hasOrgScopedSubscription = Boolean(subscriptionData?.data?.isOrgScoped)
  const isLoading =
    isSubscriptionLoading ||
    isUsageLimitLoading ||
    isWorkspaceLoading ||
    (hasOrgScopedSubscription && isOrgBillingLoading)

  const isCancelledAtPeriodEnd = subscriptionData?.data?.cancelAtPeriodEnd === true

  const subscription = {
    isFree: isFree(subscriptionData?.data?.plan),
    isPro: isPro(subscriptionData?.data?.plan),
    isTeam: isTeam(subscriptionData?.data?.plan),
    isEnterprise: isEnterprise(subscriptionData?.data?.plan),
    isPaid:
      isPaid(subscriptionData?.data?.plan) &&
      hasPaidSubscriptionStatus(subscriptionData?.data?.status),
    /**
     * True when the subscription is attached to an org (regardless of plan
     * name). Drives routing of usage-limit edits and whether we show pooled
     * or personal usage.
     */
    isOrgScoped: Boolean(subscriptionData?.data?.isOrgScoped),
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

  const billedAccountUserId = workspaceData?.settings?.workspace?.billedAccountUserId ?? null
  const workspaceMode = workspaceData?.settings?.workspace?.workspaceMode ?? null
  const isGrandfatheredSharedWorkspace = workspaceMode === 'grandfathered_shared'
  const workspaceAdmins: UpgradeStateWorkspaceAdmin[] =
    workspaceData?.permissions?.users?.filter(
      (user: UpgradeStateWorkspaceAdmin) => user.permissionType === 'admin'
    ) || []

  const updateWorkspaceSettings = useCallback(
    async (updates: { billedAccountUserId?: string }) => {
      if (!workspaceId) return
      try {
        await updateWorkspaceMutation.mutateAsync({ workspaceId, ...updates })
      } catch (error) {
        logger.error('Error updating workspace settings:', { error })
        throw error
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutateAsync is stable in TanStack Query v5
    [workspaceId]
  )

  /**
   * Sync the billing-period toggle to a paid subscriber's actual interval once
   * subscription data loads. Free/unsubscribed users keep the Annual default
   * (the API reports `billingInterval: 'month'` for them, which must not
   * override the default).
   */
  useEffect(() => {
    if (!hasInitializedInterval.current && subscription.isPaid) {
      hasInitializedInterval.current = true
      setIsAnnual(subscriptionData?.data?.billingInterval === 'year')
    }
  }, [subscription.isPaid, subscriptionData?.data?.billingInterval])

  const userRole = subscriptionData?.data?.organization?.role ?? 'member'
  const isTeamAdmin = ['owner', 'admin'].includes(userRole)
  const shouldUseOrganizationBillingContext = subscription.isOrgScoped && isTeamAdmin

  const planIncludedAmount =
    subscription.isOrgScoped && isTeamAdmin && organizationBillingData?.data
      ? organizationBillingData.data.minimumBillingAmount
      : getPlanTierCredits(subscription.plan) / CREDIT_MULTIPLIER

  const effectiveUsageLimit =
    subscription.isOrgScoped && isTeamAdmin && organizationBillingData?.data
      ? organizationBillingData.data.totalUsageLimit
      : usageLimitData.currentLimit || usage.limit

  const isOnDemandActive =
    subscription.isPaid && planIncludedAmount > 0 && effectiveUsageLimit > planIncludedAmount

  const effectiveCurrentUsage =
    subscription.isOrgScoped && organizationBillingData?.data?.totalCurrentUsage != null
      ? organizationBillingData.data.totalCurrentUsage
      : usage.current

  const canDisableOnDemand = isOnDemandActive && effectiveCurrentUsage <= planIncludedAmount

  const handleToggleOnDemand = useCallback(async () => {
    try {
      if (shouldUseOrganizationBillingContext && !billingOrganizationId) {
        throw new Error(
          'Organization billing context is unavailable. Please refresh and try again.'
        )
      }

      if (isOnDemandActive) {
        if (!canDisableOnDemand) return
        if (shouldUseOrganizationBillingContext) {
          await updateOrgLimit.mutateAsync({
            organizationId: billingOrganizationId!,
            limit: planIncludedAmount,
          })
        } else {
          await updateUserLimit.mutateAsync({ limit: planIncludedAmount })
        }
      } else {
        if (shouldUseOrganizationBillingContext) {
          await updateOrgLimit.mutateAsync({
            organizationId: billingOrganizationId!,
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
    shouldUseOrganizationBillingContext,
    billingOrganizationId,
    planIncludedAmount,
  ])

  const permissions = getSubscriptionPermissions(
    {
      isFree: subscription.isFree,
      isPro: subscription.isPro,
      isTeam: subscription.isTeam,
      isEnterprise: subscription.isEnterprise,
      isPaid: subscription.isPaid,
      isOrgScoped: subscription.isOrgScoped,
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

  const badgeConfig = ((): { text: string; variant: 'blue-secondary' | 'red' } => {
    if (permissions.isEnterpriseMember) return { text: '', variant: 'blue-secondary' }
    if (permissions.showTeamMemberView || subscription.isEnterprise)
      return { text: `${subscription.seats} seats`, variant: 'blue-secondary' }
    if (isDispute) return { text: 'Get Help', variant: 'red' }
    if (isBlocked) return { text: 'Fix Now', variant: 'red' }
    if (subscription.isFree) return { text: 'Upgrade', variant: 'blue-secondary' }
    return { text: '', variant: 'blue-secondary' }
  })()

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
        alert(getErrorMessage(error, 'Unknown error occurred'))
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
      const context = subscription.isOrgScoped ? 'organization' : 'user'
      if (context === 'organization' && !billingOrganizationId) {
        alert('Organization billing context is unavailable. Please refresh and try again.')
        return
      }
      openBillingPortal.mutate(
        {
          context,
          organizationId: billingOrganizationId ?? undefined,
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
    subscription.isOrgScoped,
    billingOrganizationId,
    doUpgrade,
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
      await requestJson(billingSwitchPlanContract, {
        body: { targetPlanName: subscription.plan, interval },
      })
      await refetchSubscription()
    },
    [refetchSubscription, subscription.plan, isLegacyPlan]
  )

  const showUpgradePlans = permissions.showUpgradePlans

  const currentCredits = getPlanTierCredits(subscription.plan)
  const hasPaidPlan = isPro(subscription.plan) || isTeam(subscription.plan)
  const isLegacyTeam = subscription.plan === 'team'
  const isOnKnownTier = currentCredits === PRO_TIER.credits || currentCredits === MAX_TIER.credits
  const isOnProTier =
    hasPaidPlan &&
    !isLegacyTeam &&
    (currentCredits === PRO_TIER.credits || (!isOnKnownTier && !subscription.isTeam))
  const isOnMaxTier =
    hasPaidPlan &&
    (currentCredits === MAX_TIER.credits || isLegacyTeam || (!isOnKnownTier && subscription.isTeam))
  const wantsIntervalSwitch =
    hasPaidPlan && !isLegacyPlan && isAnnual !== (currentInterval === 'year')
  const isOnPro = isOnProTier && !wantsIntervalSwitch
  const isOnMax = isOnMaxTier && !wantsIntervalSwitch

  const onCancel = useCallback(async () => {
    setManagePlanModalOpen(false)
    if (!betterAuthSubscription.cancel) return
    try {
      const isOrgSub = subscription.isOrgScoped
      const referenceId = isOrgSub
        ? (() => {
            if (!billingOrganizationId) {
              throw new Error(
                'Organization billing context is unavailable. Please refresh and try again.'
              )
            }
            return billingOrganizationId
          })()
        : session?.user?.id || ''
      const returnUrl = getBaseUrl() + window.location.pathname
      await betterAuthSubscription.cancel({ returnUrl, referenceId })
    } catch (e) {
      logger.error('Failed to cancel subscription', { error: e })
      alert(getErrorMessage(e, 'Failed to cancel subscription'))
    }
  }, [betterAuthSubscription, subscription.isOrgScoped, billingOrganizationId, session?.user?.id])

  const onRestore = useCallback(async () => {
    if (!betterAuthSubscription.restore) return
    try {
      const isOrgSub = subscription.isOrgScoped
      const referenceId = isOrgSub
        ? (() => {
            if (!billingOrganizationId) {
              throw new Error(
                'Organization billing context is unavailable. Please refresh and try again.'
              )
            }
            return billingOrganizationId
          })()
        : session?.user?.id || ''
      await betterAuthSubscription.restore({ referenceId })
      await refetchSubscription()
      setManagePlanModalOpen(false)
    } catch (e) {
      logger.error('Failed to restore subscription', { error: e })
      alert(getErrorMessage(e, 'Failed to restore subscription'))
    }
  }, [
    betterAuthSubscription,
    subscription.isOrgScoped,
    billingOrganizationId,
    session?.user?.id,
    refetchSubscription,
  ])

  const openBillingPortalWindow = useCallback(() => {
    const portalWindow = window.open('', '_blank')
    const context = subscription.isOrgScoped ? 'organization' : 'user'
    if (context === 'organization' && !billingOrganizationId) {
      portalWindow?.close()
      alert('Organization billing context is unavailable. Please refresh and try again.')
      return
    }
    openBillingPortal.mutate(
      {
        context,
        organizationId: billingOrganizationId ?? undefined,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openBillingPortal.mutate is stable in TanStack Query v5
  }, [subscription.isOrgScoped, billingOrganizationId])

  const upgradeOrSwitchToMax = useCallback(async () => {
    const planType = subscription.isTeam ? 'team' : 'pro'
    try {
      await requestJson(billingSwitchPlanContract, {
        body: {
          targetPlanName: `${planType}_${MAX_TIER.credits}`,
          interval: isAnnual ? 'year' : 'month',
        },
      })
      await refetchSubscription()
    } catch (e) {
      alert(getErrorMessage(e, 'Failed to upgrade'))
    }
  }, [subscription.isTeam, isAnnual, refetchSubscription])

  const onUpgradeToOtherTier = useCallback(async () => {
    const onMax =
      getPlanTierCredits(subscription.plan) === MAX_TIER.credits || subscription.plan === 'team'
    const targetTier = onMax ? PRO_TIER : MAX_TIER
    const planType = subscription.isTeam ? 'team' : 'pro'
    const targetPlanName = `${planType}_${targetTier.credits}`
    try {
      await requestJson(billingSwitchPlanContract, {
        body: { targetPlanName },
      })
      await refetchSubscription()
      setManagePlanModalOpen(false)
    } catch (e) {
      alert(getErrorMessage(e, 'Failed to switch plan'))
    }
  }, [subscription.plan, subscription.isTeam, refetchSubscription])

  const onUpgradeToCurrentTier = useCallback(async () => {
    const onMax =
      getPlanTierCredits(subscription.plan) === MAX_TIER.credits || subscription.plan === 'team'
    const currentTier = onMax ? MAX_TIER : PRO_TIER
    const planType = subscription.isTeam ? 'team' : 'pro'
    const targetPlanName = `${planType}_${currentTier.credits}`
    try {
      await requestJson(billingSwitchPlanContract, {
        body: { targetPlanName },
      })
      await refetchSubscription()
      setManagePlanModalOpen(false)
    } catch (e) {
      alert(getErrorMessage(e, 'Failed to migrate plan'))
    }
  }, [subscription.plan, subscription.isTeam, refetchSubscription])

  return {
    isLoading,
    isAnnual,
    setIsAnnual,
    subscription,
    isLegacyPlan,
    isCancelledAtPeriodEnd,
    currentInterval,
    permissions,
    showUpgradePlans,
    proTier: PRO_TIER,
    maxTier: MAX_TIER,
    isOnPro,
    isOnMax,
    isOnProTier,
    isOnMaxTier,
    wantsIntervalSwitch,
    usage,
    usageLimitData,
    organizationBillingData,
    billingOrganizationId,
    isTeamAdmin,
    shouldUseOrganizationBillingContext,
    onDemandState,
    canDisableOnDemand,
    hasUsablePaidAccess,
    isBlocked,
    showBadge,
    badgeConfig,
    creditBalance: subscriptionData?.data?.creditBalance ?? 0,
    periodEnd: subscriptionData?.data?.periodEnd ?? null,
    workspaceId,
    isGrandfatheredSharedWorkspace,
    workspaceAdmins,
    billedAccountUserId,
    canManageWorkspaceKeys,
    updateWorkspaceSettings,
    isUpdatingWorkspace: updateWorkspaceMutation.isPending,
    isBillingPortalPending: openBillingPortal.isPending,
    managePlanModalOpen,
    setManagePlanModalOpen,
    usageLimitRef,
    doUpgrade,
    handleSwitchInterval,
    handleToggleOnDemand,
    handleBadgeClick,
    onCancel,
    onRestore,
    openBillingPortalWindow,
    upgradeOrSwitchToMax,
    onUpgradeToOtherTier,
    onUpgradeToCurrentTier,
    refetchSubscription,
  }
}
