import { getSubscriptionAccessState } from '@/lib/billing/client'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { useWorkspaceOwnerBilling } from '@/hooks/queries/workspace'

const isBillingEnabledClient = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))
const isForkingEnabledClient = isTruthy(getEnv('NEXT_PUBLIC_FORKING_ENABLED'))

interface ForkingAvailability {
  available: boolean
  /** The billing lookup is still in flight - callers that gate a whole page wait on this. */
  isLoading: boolean
}

/**
 * Client mirror of the server fork EE gate (`assertForkingEnabled`): on Sim Cloud
 * the active workspace's billed account (its owner's rolled-up plan) must be
 * Enterprise; on self-hosted it's the `NEXT_PUBLIC_FORKING_ENABLED` override. Used
 * to hide the fork UI (and skip the lineage query) for workspaces that cannot fork.
 *
 * Gating on the WORKSPACE's plan (not the viewer's) is what matches the server,
 * which checks the workspace org's plan: a viewer who belongs to a different
 * Enterprise org no longer sees fork UI on a non-Enterprise workspace, and a
 * member of an Enterprise workspace isn't denied it just because their own
 * highest plan is lower. The server gate remains the security boundary.
 *
 * Self-hosted relies on `NEXT_PUBLIC_FORKING_ENABLED` / `NEXT_PUBLIC_BILLING_ENABLED`
 * mirroring the server's `FORKING_ENABLED` / `BILLING_ENABLED`; set each pair
 * together or the UI and API will disagree.
 */
export function useForkingAvailability(workspaceId?: string): ForkingAvailability {
  const { data, isLoading } = useWorkspaceOwnerBilling(
    isBillingEnabledClient ? workspaceId : undefined
  )
  if (!isBillingEnabledClient) return { available: isForkingEnabledClient, isLoading: false }
  return { available: getSubscriptionAccessState(data).hasUsableEnterpriseAccess, isLoading }
}

/** Boolean shorthand for surfaces that only show/hide fork entry points. */
export function useForkingAvailable(workspaceId?: string): boolean {
  return useForkingAvailability(workspaceId).available
}
