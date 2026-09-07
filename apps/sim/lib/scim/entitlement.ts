import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { isScimEnabled } from '@/lib/core/config/env-flags'

/**
 * Whether directory provisioning may run for an organization.
 *
 * The deployment flag is the outer gate on every deployment: hosted or not, a
 * deployment that has not turned the feature on serves no SCIM surface, and an
 * enterprise subscription cannot override that. Inside the gate, hosted
 * deployments require the enterprise plan and self-hosted ones are entitled by
 * the flag alone.
 */
export async function isScimEntitledForOrganization(organizationId: string): Promise<boolean> {
  if (!isScimEnabled) return false
  return isOrganizationFeatureEntitled(organizationId, true)
}
