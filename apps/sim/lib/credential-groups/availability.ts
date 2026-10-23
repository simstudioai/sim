import { isCredentialGroupsEnabled, isHosted } from '@/lib/core/config/env-flags'

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
  if (!organizationId) return { available: false, reason: 'feature_disabled' }
  if (isHosted) {
    return ownerBilling.isEnterprise
      ? { available: true }
      : { available: false, reason: 'enterprise_plan_required' }
  }
  return isCredentialGroupsEnabled
    ? { available: true }
    : { available: false, reason: 'feature_disabled' }
}

/**
 * Credential Groups require an active Enterprise subscription on Sim Cloud and
 * the `credentialGroups` enterprise entitlement on self-hosted deployments.
 */
export async function isCredentialGroupsAvailable(
  input: CredentialGroupsAvailabilityInput
): Promise<boolean> {
  return (await resolveCredentialGroupsAvailability(input)).available
}
