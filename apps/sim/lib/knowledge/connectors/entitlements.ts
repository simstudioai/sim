import type { WorkspaceOwnerBilling } from '@/lib/api/contracts/workspaces'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { getDeploymentShape } from '@/lib/core/config/deployment-shape'

/**
 * Client mirror of `hasWorkspaceLiveSyncAccess`.
 *
 * Reads the same two deployment flags in the same order as the server helper so the
 * two cannot diverge: sub-hourly sync is ungated off the hosted deployment even when
 * billing is enabled. Without the `hosted` branch a self-hosted operator with billing
 * on saw the "Live" interval locked while the API would have accepted it.
 */
export function hasWorkspaceMaxConnectorAccess(ownerBilling: WorkspaceOwnerBilling): boolean {
  const { hosted, billingEnabled } = getDeploymentShape()
  if (!hosted || !billingEnabled) return true
  return getSubscriptionAccessState(ownerBilling).hasUsableMaxAccess
}
