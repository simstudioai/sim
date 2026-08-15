import { isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

export type CredentialGroupsAvailability =
  | { available: true }
  | { available: false; reason: 'feature_disabled' | 'enterprise_plan_required' }

export async function resolveCredentialGroupsAvailability(ownerBilling: {
  isEnterprise: boolean
}): Promise<CredentialGroupsAvailability> {
  if (!(await isFeatureEnabled('credential-groups'))) {
    return { available: false, reason: 'feature_disabled' }
  }
  if (isHosted && !ownerBilling.isEnterprise) {
    return { available: false, reason: 'enterprise_plan_required' }
  }
  return { available: true }
}

/** Credential Groups are globally gated and restricted to Enterprise workspaces on Sim Cloud. */
export async function isCredentialGroupsAvailable(ownerBilling: {
  isEnterprise: boolean
}): Promise<boolean> {
  return (await resolveCredentialGroupsAvailability(ownerBilling)).available
}
