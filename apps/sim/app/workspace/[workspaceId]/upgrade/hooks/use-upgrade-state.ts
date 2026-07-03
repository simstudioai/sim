'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { requestJson } from '@/lib/api/client/request'
import { billingSwitchPlanContract } from '@/lib/api/contracts/subscription'
import { useSubscriptionUpgrade } from '@/lib/billing/client/upgrade'
import { CREDIT_TIERS } from '@/lib/billing/constants'
import {
  getPlanTierCredits,
  isEnterprise,
  isFree,
  isPaid,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import { hasPaidSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { getSubscriptionPermissions } from '@/app/workspace/[workspaceId]/upgrade/subscription-permissions'
import { useSubscriptionData } from '@/hooks/queries/subscription'

const PRO_TIER = CREDIT_TIERS[0]
const MAX_TIER = CREDIT_TIERS[1]

type TargetPlan = 'pro' | 'team'

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
  }
  showUpgradePlans: boolean
  proTier: { credits: number; dollars: number; name: string }
  maxTier: { credits: number; dollars: number; name: string }
  isOnPro: boolean
  isOnMax: boolean
  isOnMaxTier: boolean
  wantsIntervalSwitch: boolean
  doUpgrade: (targetPlan: 'pro' | 'team', creditTier: number, seats?: number) => Promise<void>
  handleSwitchInterval: (interval: 'month' | 'year') => Promise<void>
  upgradeOrSwitchToMax: () => Promise<void>
  onUpgradeToOtherTier: () => Promise<void>
}

/**
 * Plan-selection state hook for the Upgrade page. Surfaces only what the plan
 * cards and billing-period toggle need: the resolved tier, upgrade/downgrade/
 * interval-switch handlers, and whether to show the upgrade plans at all.
 *
 * Plan and billing management (payment method, cancellation, invoices, usage
 * limits) lives on the Billing settings page, not here.
 */
export function useUpgradeState(): UpgradeState {
  const { handleUpgrade } = useSubscriptionUpgrade()

  const {
    data: subscriptionData,
    isLoading,
    refetch: refetchSubscription,
  } = useSubscriptionData({ includeOrg: true })

  const [isAnnual, setIsAnnual] = useState(true)
  const hasInitializedInterval = useRef(false)

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
     * name). Feeds the permission resolution below.
     */
    isOrgScoped: Boolean(subscriptionData?.data?.isOrgScoped),
    plan: subscriptionData?.data?.plan || 'free',
    status: subscriptionData?.data?.status || 'inactive',
  }

  const isLegacyPlan = subscription.plan === 'pro' || subscription.plan === 'team'

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
  const isTeamAdmin = isOrgAdminRole(userRole)

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

  const showUpgradePlans = permissions.showUpgradePlans

  const doUpgrade = useCallback(
    async (targetPlan: TargetPlan, creditTier: number, seats?: number) => {
      try {
        await handleUpgrade(targetPlan, {
          creditTier,
          annual: isAnnual,
          ...(seats ? { seats } : {}),
        })
      } catch (error) {
        toast.error(getErrorMessage(error, 'Unknown error occurred'))
      }
    },
    [handleUpgrade, isAnnual]
  )

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
      toast.error(getErrorMessage(e, 'Failed to upgrade'))
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
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to switch plan'))
    }
  }, [subscription.plan, subscription.isTeam, refetchSubscription])

  return {
    isLoading,
    isAnnual,
    setIsAnnual,
    subscription,
    showUpgradePlans,
    proTier: PRO_TIER,
    maxTier: MAX_TIER,
    isOnPro,
    isOnMax,
    isOnMaxTier,
    wantsIntervalSwitch,
    doUpgrade,
    handleSwitchInterval,
    upgradeOrSwitchToMax,
    onUpgradeToOtherTier,
  }
}
