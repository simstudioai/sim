import type { WorkspaceOwnerBilling } from '@/lib/api/contracts/workspaces'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'

/**
 * Client mirror of `hasWorkspaceLiveSyncAccess`.
 *
 * Reads the same two env flags in the same order as the server helper so the two
 * cannot diverge: sub-hourly sync is ungated off the hosted deployment even when
 * billing is enabled. Without the `isHosted` branch a self-hosted operator with
 * billing on saw the "Live" interval locked while the API would have accepted it.
 */
export function hasWorkspaceMaxConnectorAccess(ownerBilling: WorkspaceOwnerBilling): boolean {
  if (!isHosted || !isBillingEnabled) return true
  return getSubscriptionAccessState(ownerBilling).hasUsableMaxAccess
}
