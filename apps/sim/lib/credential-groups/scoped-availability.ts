import { isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { getOrganizationSubscriptionUsable } from '@/lib/billing/core/subscription'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { hasPaidSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'

/** Uses the resource's exact payer and flag scope; organization membership never implies workspace access. */
export async function isScopedCredentialGroupsAvailable(scope: ResourceScope): Promise<boolean> {
  if (scope.kind === 'workspace') {
    const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(scope.workspaceId)
    return isCredentialGroupsAvailable({ workspaceId: scope.workspaceId, ownerBilling })
  }
  if (!(await isFeatureEnabled('credential-groups', { orgId: scope.organizationId }))) return false
  if (!isHosted) return true
  const [subscription, blocked] = await Promise.all([
    getOrganizationSubscriptionUsable(scope.organizationId, { onError: 'throw' }),
    isOrganizationBillingBlocked(scope.organizationId),
  ])
  return (
    !blocked && hasPaidSubscriptionStatus(subscription?.status) && isEnterprise(subscription?.plan)
  )
}
