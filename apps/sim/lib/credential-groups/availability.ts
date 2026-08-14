import type { WorkspaceOwnerBilling } from '@/lib/api/contracts/workspaces'
import { isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

/** Credential Groups are globally gated and restricted to Enterprise workspaces on Sim Cloud. */
export async function isCredentialGroupsAvailable(
  ownerBilling: Pick<WorkspaceOwnerBilling, 'isEnterprise'>
): Promise<boolean> {
  if (!(await isFeatureEnabled('credential-groups'))) return false
  return !isHosted || ownerBilling.isEnterprise
}
