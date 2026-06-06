'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { Chip } from '@/components/emcn'
import { Credit } from '@/components/emcn/icons'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { formatCredits } from '@/lib/billing/credits/conversion'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { useMyMemberCredits } from '@/hooks/queries/organization'
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
  const { data: memberCredits } = useMyMemberCredits(workspaceId)

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

  const renderChip = (dollars: number) => (
    <Chip
      aria-label='Credits remaining — upgrade plan'
      onClick={() => router.push(upgradeHref)}
      onMouseEnter={prefetchUpgrade}
      onFocus={prefetchUpgrade}
      leftIcon={Credit}
    >
      {formatCredits(dollars)}
    </Chip>
  )

  /**
   * A per-member org credit cap is the authoritative personal remaining for this
   * member — show it even when the plan-based chip would otherwise be hidden (e.g.
   * external members). Values are dollars (the chip formats via `formatCredits`),
   * clamped at 0 so an over-cap member never sees a negative.
   */
  const limitDollars = memberCredits?.limitDollars ?? null
  if (limitDollars !== null) {
    return renderChip(Math.max(0, limitDollars - (memberCredits?.usedDollars ?? 0)))
  }

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

  return renderChip(remainingCredits)
}
