import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isHosted, isScimEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Whether this deployment serves directory provisioning at all.
 *
 * The hosted product ships it as part of the enterprise plan, the same way SSO
 * ships by default, with SCIM_ENABLED=false available to defer activation.
 * A self-hosted deployment turns it on with the enterprise switch
 * (`ENTERPRISE_ENABLED`) or the feature's own variable (`SCIM_ENABLED`), which
 * also lets an operator turn just this feature off.
 */
export function isScimDeploymentEnabled(): boolean {
  return isScimEnabled
}

/**
 * Whether directory provisioning may run for an organization: the deployment
 * serves it, and on the hosted product the organization holds the enterprise
 * plan.
 *
 * Billing read failures propagate because a false entitlement also releases
 * managed-membership and JIT locks; an outage must not relax those policies.
 */
export async function isScimEntitledForOrganization(
  organizationId: string,
  executor?: DbOrTx
): Promise<boolean> {
  if (!isScimDeploymentEnabled()) return false
  if (!isHosted) return true
  return isOrganizationOnEnterprisePlan(organizationId, 'throw', executor)
}
