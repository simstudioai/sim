import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isHosted, isScimEnabled } from '@/lib/core/config/env-flags'

/**
 * Whether this deployment serves directory provisioning at all.
 *
 * The hosted product ships it as part of the enterprise plan, the same way SSO
 * ships: nothing to switch on. A self-hosted deployment turns it on with the
 * enterprise switch (`ENTERPRISE_ENABLED`) or the feature's own variable
 * (`SCIM_ENABLED`), which also lets an operator turn just this feature off.
 */
export function isScimDeploymentEnabled(): boolean {
  return isHosted || isScimEnabled
}

/**
 * Whether directory provisioning may run for an organization: the deployment
 * serves it, and on the hosted product the organization holds the enterprise
 * plan.
 */
export async function isScimEntitledForOrganization(organizationId: string): Promise<boolean> {
  if (!isScimDeploymentEnabled()) return false
  if (!isHosted) return true
  return isOrganizationOnEnterprisePlan(organizationId)
}
