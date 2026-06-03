'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { Chip } from '@/components/emcn'
import { Credit } from '@/components/emcn/icons'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { formatCredits } from '@/lib/billing/credits/conversion'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { usePlanView } from '@/hooks/queries/plan-view'
import { prefetchUpgradeBillingData, useSubscriptionData } from '@/hooks/queries/subscription'
import { prefetchWorkspaceSettings } from '@/hooks/queries/workspace'

export function CreditsChip() {
  if (!isBillingEnabled) return null

  return <CreditsChipInner />
}

function CreditsChipInner() {
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

  const upgradeHref = `/workspace/${workspaceId}/upgrade`

  /**
   * Warm the route bundle and the exact queries the Upgrade page gates on, so
   * the click navigates into already-cached data instead of a blank, loading page.
   */
  const prefetchUpgrade = useCallback(() => {
    router.prefetch(upgradeHref)
    prefetchUpgradeBillingData(queryClient)
    prefetchWorkspaceSettings(queryClient, workspaceId)
  }, [router, queryClient, upgradeHref, workspaceId])

  if (isLoading || !hasData || !data?.data) return null
  if (!planView.showCredits) return null

  const { usageLimit, currentUsage, creditBalance } = data.data

  /**
   * Credits remaining = unused plan allowance plus any purchased credit balance.
   * Uncapped plans (limit at/above the on-demand threshold) render as ∞ via
   * `formatCredits`, so short-circuit instead of subtracting usage from it.
   */
  const remainingCredits =
    usageLimit >= ON_DEMAND_UNLIMITED
      ? ON_DEMAND_UNLIMITED
      : Math.max(0, usageLimit + creditBalance - currentUsage)

  return (
    <Chip
      aria-label='Credits remaining — upgrade plan'
      onClick={() => router.push(upgradeHref)}
      onMouseEnter={prefetchUpgrade}
      onFocus={prefetchUpgrade}
      leftIcon={Credit}
    >
      {formatCredits(remainingCredits)}
    </Chip>
  )
}
