import { isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

export type CredentialGroupsAvailability =
  | { available: true }
  | { available: false; reason: 'feature_disabled' | 'enterprise_plan_required' }

/**
 * The workspace the gate is evaluated for. `workspaceId` is required so no call
 * site can silently fall back to the global clause and reveal the feature to a
 * workspace the AppConfig `credential-groups` allowlist does not name.
 */
export interface CredentialGroupsAvailabilityInput {
  workspaceId: string
  ownerBilling: { isEnterprise: boolean }
}

export async function resolveCredentialGroupsAvailability({
  workspaceId,
  ownerBilling,
}: CredentialGroupsAvailabilityInput): Promise<CredentialGroupsAvailability> {
  if (!(await isFeatureEnabled('credential-groups', { workspaceId }))) {
    return { available: false, reason: 'feature_disabled' }
  }
  if (isHosted && !ownerBilling.isEnterprise) {
    return { available: false, reason: 'enterprise_plan_required' }
  }
  return { available: true }
}

/**
 * Credential Groups are gated per workspace (globally or by the AppConfig
 * `workspaceIds` allowlist) and restricted to Enterprise workspaces on Sim Cloud.
 */
export async function isCredentialGroupsAvailable(
  input: CredentialGroupsAvailabilityInput
): Promise<boolean> {
  return (await resolveCredentialGroupsAvailability(input)).available
}
