'use client'

import { useCallback } from 'react'
import { Chip, ChipTag, Tooltip } from '@sim/emcn'
import { Credit } from '@sim/emcn/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { formatCredits } from '@/lib/billing/credits/conversion'
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { prefetchWorkspaceSettings } from '@/hooks/queries/workspace'
import { useWorkspaceCreditAvailability } from '@/hooks/queries/workspace-usage'

export function CreditsChip() {
  if (!isBillingEnabled) return null

  return <CreditsChipInner />
}

function CreditsChipInner() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()
  const { data: availability, isLoading } = useWorkspaceCreditAvailability(
    hostContext.ownerBilling.isEnterprise ? undefined : workspaceId
  )

  const upgradeHref = buildUpgradeHref(workspaceId, 'credits')
  const canManageBilling = canManageWorkspaceBilling(hostContext, session?.user?.id)

  /**
   * Warms the workspace-scoped upgrade route and settings data.
   */
  const prefetchUpgrade = useCallback(() => {
    router.prefetch(upgradeHref)
    prefetchWorkspaceSettings(queryClient, workspaceId)
  }, [router, queryClient, upgradeHref, workspaceId])

  if (hostContext.ownerBilling.isEnterprise || isLoading || !availability) return null

  const formattedCredits =
    availability.remainingDollars === null
      ? 'Available'
      : formatCredits(availability.remainingDollars)

  if (!canManageBilling) {
    const unavailableMessage = hostContext.hostOrganizationId
      ? 'Contact an organization admin to manage this workspace’s billing.'
      : 'Only the workspace owner can manage billing.'

    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <ChipTag aria-label='Workspace credits remaining' leftIcon={Credit}>
            {formattedCredits}
          </ChipTag>
        </Tooltip.Trigger>
        <Tooltip.Content>{unavailableMessage}</Tooltip.Content>
      </Tooltip.Root>
    )
  }

  return (
    <Chip
      aria-label='Workspace credits remaining — upgrade plan'
      onClick={() => router.push(upgradeHref)}
      onMouseEnter={prefetchUpgrade}
      onFocus={prefetchUpgrade}
      leftIcon={Credit}
    >
      {formattedCredits}
    </Chip>
  )
}
