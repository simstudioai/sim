import type { WorkspaceOwnerBilling } from '@/lib/api/contracts/workspaces'
import { getSubscriptionAccessState } from '@/lib/billing/client'

export function hasWorkspaceMaxConnectorAccess(
  ownerBilling: WorkspaceOwnerBilling,
  billingEnabled: boolean
): boolean {
  if (!billingEnabled) return true
  return getSubscriptionAccessState(ownerBilling).hasUsableMaxAccess
}
