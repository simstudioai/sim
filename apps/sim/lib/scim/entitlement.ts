import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isHosted, isScimEnabled } from '@/lib/core/config/env-flags'

/**
 * Whether directory provisioning may run for an organization.
 *
 * The deployment flag is the outer gate: a deployment that has not turned the
 * feature on serves no SCIM surface, and no subscription overrides that. Inside
 * the gate, a self-hosted deployment is entitled by the flag alone and the
 * hosted product requires the enterprise plan — the same shape SSO access uses.
 */
export async function isScimEntitledForOrganization(organizationId: string): Promise<boolean> {
  if (!isScimEnabled) return false
  if (!isHosted) return true
  return isOrganizationOnEnterprisePlan(organizationId)
}
