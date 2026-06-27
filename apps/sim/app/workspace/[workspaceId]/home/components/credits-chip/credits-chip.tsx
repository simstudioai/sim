'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { Chip } from '@/components/emcn'
import { Credit } from '@/components/emcn/icons'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { formatCredits } from '@/lib/billing/credits/conversion'
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { useMyMemberCredits } from '@/hooks/queries/organization'
import { usePlanView } from '@/hooks/queries/plan-view'
import { prefetchUpgradeBillingData, useSubscriptionData } from '@/hooks/queries/subscription'
import { prefetchWorkspaceSettings } from '@/hooks/queries/workspace'
import { useTranslations } from 'next-intl'

export function CreditsChip() {
  if (!isBillingEnabled) return null

  return <CreditsChipInner />
}

function CreditsChipInner() {
  const t = useTranslations('auto')
  const { planView, isLoading, hasData } = usePlanView()
  /**
   * `usePlanView` is built on top of `useSubscriptionData`, so the second call
   * dedups against the same React Query cache entry. We read the raw usage
   * fields here because `planView` intentionally only exposes plan-derived
   * decisions, not display math.
   */
  const { data } = useSubscriptionData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: memberCredits, isLoading: memberLoading } = useMyMemberCredits(workspaceId)

  const upgradeHref = buildUpgradeHref(workspaceId, 'credits')

  /**
   * Warm the route bundle and the exact queries the Upgrade page gates on, so
   * the click navigates into already-cached data instead of a blank, loading page.
   */
  const prefetchUpgrade = useCallback(() => {
    router.prefetch(upgradeHref)
    prefetchUpgradeBillingData(queryClient)
    prefetchWorkspaceSettings(queryClient, workspaceId)
  }, [router, queryClient, upgradeHref, workspaceId])

  const renderChip = (dollars: number) => (
    <Chip
      aria-label={t('credits_remaining_upgrade_plan')}
      onClick={() => router.push(upgradeHref)}
      onMouseEnter={prefetchUpgrade}
      onFocus={prefetchUpgrade}
      leftIcon={Credit}
    >
      {formatCredits(dollars)}
    </Chip>
  )

  // Wait for the per-member cap result before rendering: until it resolves,
  // `limitDollars` is null and a capped member would briefly see the larger
  // pooled number. Disabled (no workspace) → not loading, so non-org users are
  // unaffected; cached after the first load (30s staleTime), so it's a one-time
  // wait, not a per-navigation one.
  if (memberLoading) return null

  /**
   * Pooled/plan remaining (dollars): unused plan allowance plus any purchased
   * credit balance. Null when the plan-based chip wouldn't show on its own (data
   * not ready, or the plan isn't credit-metered). `ON_DEMAND_UNLIMITED` means
   * effectively unbounded — rendered as ∞ — so short-circuit instead of
   * subtracting usage from the sentinel.
   */
  const pooledData = !isLoading && hasData && planView.showCredits ? (data?.data ?? null) : null
  const pooledRemaining =
    pooledData === null
      ? null
      : pooledData.usageLimit >= ON_DEMAND_UNLIMITED
        ? ON_DEMAND_UNLIMITED
        : Math.max(0, pooledData.usageLimit + pooledData.creditBalance - pooledData.currentUsage)

  /**
   * A per-member cap is the authoritative personal remaining, but the actor gate
   * blocks on the pooled cap first — so show the tighter of the two, or a member
   * could see credits left while every action 402s on org/plan usage. Clamp at 0.
   * Fall back to personal alone when pooled isn't available/shown, so a capped
   * member still sees a balance even where the plan chip would be hidden.
   */
  const limitDollars = memberCredits?.limitDollars ?? null
  if (limitDollars !== null) {
    const personalRemaining = Math.max(0, limitDollars - (memberCredits?.usedDollars ?? 0))
    return renderChip(
      pooledRemaining === null ? personalRemaining : Math.min(personalRemaining, pooledRemaining)
    )
  }

  if (pooledRemaining === null) return null
  return renderChip(pooledRemaining)
}
