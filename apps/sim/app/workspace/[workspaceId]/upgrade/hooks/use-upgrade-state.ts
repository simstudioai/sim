'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { billingSwitchPlanContract } from '@/lib/api/contracts/subscription'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { useSubscriptionUpgrade } from '@/lib/billing/client/upgrade'
import { CREDIT_TIERS } from '@/lib/billing/constants'
import { getPlanTierCredits, isEnterprise, isFree, isPro, isTeam } from '@/lib/billing/plan-helpers'
import { workspaceHostKeys } from '@/hooks/queries/workspace-host'

const PRO_TIER = CREDIT_TIERS[0]
const MAX_TIER = CREDIT_TIERS[1]

type TargetPlan = 'pro' | 'team'

interface UseUpgradeStateOptions {
  hostContext: WorkspaceHostContext
  workspaceId: string
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
  }
  showUpgradePlans: boolean
  proTier: { credits: number; dollars: number; name: string }
  maxTier: { credits: number; dollars: number; name: string }
  isOnPro: boolean
  isOnMax: boolean
  isOnMaxTier: boolean
  wantsIntervalSwitch: boolean
  doUpgrade: (targetPlan: 'pro' | 'team', creditTier: number) => Promise<void>
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
export function useUpgradeState({
  hostContext,
  workspaceId,
}: UseUpgradeStateOptions): UpgradeState {
  const { handleUpgrade } = useSubscriptionUpgrade()
  const queryClient = useQueryClient()
  const { ownerBilling } = hostContext
  const [isAnnual, setIsAnnual] = useState(
    !ownerBilling.isPaid || ownerBilling.billingInterval === 'year'
  )

  const subscription = {
    isFree: isFree(ownerBilling.plan),
    isPro: isPro(ownerBilling.plan),
    isTeam: isTeam(ownerBilling.plan),
    isEnterprise: isEnterprise(ownerBilling.plan),
    isPaid: ownerBilling.isPaid,
    isOrgScoped: Boolean(hostContext.hostOrganizationId),
    plan: ownerBilling.plan,
    status: ownerBilling.status ?? 'inactive',
  }

  const isLegacyPlan = subscription.plan === 'pro' || subscription.plan === 'team'

  /**
   * Keeps the toggle aligned when the host context refreshes after a plan change.
   */
  useEffect(() => {
    if (subscription.isPaid) {
      setIsAnnual(ownerBilling.billingInterval === 'year')
    }
  }, [ownerBilling.billingInterval, subscription.isPaid])

  const refreshHostContext = useCallback(
    () => queryClient.invalidateQueries({ queryKey: workspaceHostKeys.detail(workspaceId) }),
    [queryClient, workspaceId]
  )

  const doUpgrade = useCallback(
    async (targetPlan: TargetPlan, creditTier: number) => {
      try {
        await handleUpgrade(targetPlan, {
          creditTier,
          annual: isAnnual,
          ...(hostContext.hostOrganizationId
            ? { organizationId: hostContext.hostOrganizationId }
            : {}),
        })
      } catch (error) {
        toast.error(getErrorMessage(error, 'Unknown error occurred'))
      }
    },
    [handleUpgrade, hostContext.hostOrganizationId, isAnnual]
  )

  const currentInterval = ownerBilling.billingInterval

  const handleSwitchInterval = useCallback(
    async (interval: 'month' | 'year') => {
      if (isLegacyPlan) {
        throw new Error(
          'Interval switching is not available on legacy plans. Please upgrade first.'
        )
      }
      await requestJson(billingSwitchPlanContract, {
        body: { targetPlanName: subscription.plan, interval, workspaceId },
      })
      await refreshHostContext()
    },
    [isLegacyPlan, refreshHostContext, subscription.plan, workspaceId]
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
          workspaceId,
        },
      })
      await refreshHostContext()
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to upgrade'))
    }
  }, [subscription.isTeam, isAnnual, refreshHostContext, workspaceId])

  const onUpgradeToOtherTier = useCallback(async () => {
    const onMax =
      getPlanTierCredits(subscription.plan) === MAX_TIER.credits || subscription.plan === 'team'
    const targetTier = onMax ? PRO_TIER : MAX_TIER
    const planType = subscription.isTeam ? 'team' : 'pro'
    const targetPlanName = `${planType}_${targetTier.credits}`
    try {
      await requestJson(billingSwitchPlanContract, {
        body: { targetPlanName, workspaceId },
      })
      await refreshHostContext()
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to switch plan'))
    }
  }, [subscription.plan, subscription.isTeam, refreshHostContext, workspaceId])

  return {
    isLoading: false,
    isAnnual,
    setIsAnnual,
    subscription,
    showUpgradePlans: !subscription.isEnterprise,
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
