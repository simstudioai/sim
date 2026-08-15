import { isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

export function isCredentialGroupsEnterprisePlanRequired(ownerBilling: {
  isEnterprise: boolean
}): boolean {
  return isHosted && !ownerBilling.isEnterprise
}

/** Credential Groups are globally gated and restricted to Enterprise workspaces on Sim Cloud. */
export async function isCredentialGroupsAvailable(ownerBilling: {
  isEnterprise: boolean
}): Promise<boolean> {
  if (!(await isFeatureEnabled('credential-groups'))) return false
  return !isCredentialGroupsEnterprisePlanRequired(ownerBilling)
}
