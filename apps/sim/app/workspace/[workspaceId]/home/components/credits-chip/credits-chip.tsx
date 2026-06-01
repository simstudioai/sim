'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { Chip } from '@/components/emcn'
import { Credit } from '@/components/emcn/icons'
import { formatCredits } from '@/lib/billing/credits/conversion'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { prefetchUpgradeBillingData, useSubscriptionData } from '@/hooks/queries/subscription'
import { prefetchWorkspaceSettings } from '@/hooks/queries/workspace'

export function CreditsChip() {
  if (!isBillingEnabled) return null

  return <CreditsChipInner />
}

function CreditsChipInner() {
  const { data, isLoading } = useSubscriptionData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  const upgradeHref = `/workspace/${workspaceId}/upgrade`

  // Warm the route bundle and the exact queries the Upgrade page gates on, so
  // the click navigates into already-cached data instead of a blank, loading page.
  const prefetchUpgrade = useCallback(() => {
    router.prefetch(upgradeHref)
    prefetchUpgradeBillingData(queryClient)
    prefetchWorkspaceSettings(queryClient, workspaceId)
  }, [router, queryClient, upgradeHref, workspaceId])

  if (isLoading || !data?.data) return null

  return (
    <Chip
      aria-label='Upgrade plan'
      onClick={() => router.push(upgradeHref)}
      onMouseEnter={prefetchUpgrade}
      onFocus={prefetchUpgrade}
      leftIcon={Credit}
    >
      {formatCredits(data.data.creditBalance)}
    </Chip>
  )
}
