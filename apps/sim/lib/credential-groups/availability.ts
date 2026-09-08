import { isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

export type CredentialGroupsAvailability =
  | { available: true }
  | { available: false; reason: 'feature_disabled' | 'enterprise_plan_required' }

/**
 * The canonical organization and its billing entitlement. Personal workspaces
 * have no organization and cannot enable connected accounts.
 */
export interface CredentialGroupsAvailabilityInput {
  organizationId: string | null
  ownerBilling: { isEnterprise: boolean }
}

export async function resolveCredentialGroupsAvailability({
  organizationId,
  ownerBilling,
}: CredentialGroupsAvailabilityInput): Promise<CredentialGroupsAvailability> {
  if (
    !organizationId ||
    !(await isFeatureEnabled('credential-groups', { orgId: organizationId }))
  ) {
    return { available: false, reason: 'feature_disabled' }
  }
  if (isHosted && !ownerBilling.isEnterprise) {
    return { available: false, reason: 'enterprise_plan_required' }
  }
  return { available: true }
}

/**
 * Credential Groups use organization rollout targeting and require an active
 * Enterprise entitlement on Sim Cloud. Workspace flag targeting is not consulted.
 */
export async function isCredentialGroupsAvailable(
  input: CredentialGroupsAvailabilityInput
): Promise<boolean> {
  return (await resolveCredentialGroupsAvailability(input)).available
}
