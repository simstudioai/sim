import { organizationMemberUsageLimit } from '@sim/db/schema'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { isAccessControlEnabled, isHosted } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'
import { resolveDefaultGroup, resolveWorkspaceGroup } from '@/lib/permission-groups/resolve.server'
import type { AccessRequestContext } from '@/ee/access-requests/lib/application/authorization'
import { getAccessRequestDeploymentUnavailableReason } from '@/ee/access-requests/lib/catalog'
import type { AccessRequestScope, AccessRequestTarget } from '@/ee/access-requests/lib/targets'
import {
  type AccessRequestCatalog,
  buildAccessRequestPolicyDelta,
  describeAccessRequestTarget,
  isAccessRequestTargetDenied,
  isAccessRequestTargetInScope,
  validateAccessRequestTarget,
} from '@/ee/access-requests/lib/targets'

export async function loadMemberLimit(
  executor: DbOrTx,
  organizationId: string,
  userId: string,
  forUpdate = false
) {
  const query = executor
    .select({
      usageLimit: organizationMemberUsageLimit.usageLimit,
      updatedAt: organizationMemberUsageLimit.updatedAt,
    })
    .from(organizationMemberUsageLimit)
    .where(
      and(
        eq(organizationMemberUsageLimit.organizationId, organizationId),
        eq(organizationMemberUsageLimit.userId, userId)
      )
    )
  const [row] = forUpdate ? await query.for('update').limit(1) : await query.limit(1)
  return row ? { ...row, credits: dollarsToCredits(Number(row.usageLimit)) } : null
}

export async function loadAccessRequestPolicy(
  executor: DbOrTx,
  context: AccessRequestContext,
  userId: string,
  entitledAtAdmission?: boolean
) {
  if (!context.organizationId) return { entitled: false, group: null, limit: null }
  const entitled =
    entitledAtAdmission !== false &&
    (isHosted
      ? await isOrganizationOnEnterprisePlan(context.organizationId, 'return-false', executor)
      : isAccessControlEnabled)
  const group = !entitled
    ? null
    : context.workspaceId
      ? await resolveWorkspaceGroup(userId, context.organizationId, context.workspaceId, executor)
      : await resolveDefaultGroup(context.organizationId, executor)
  const limit = isHosted ? await loadMemberLimit(executor, context.organizationId, userId) : null
  return { entitled, group, limit }
}

/** Hard deployment ceilings remain unavailable regardless of the permission group. */
export async function evaluateAccessRequestTarget(
  executor: DbOrTx,
  context: AccessRequestContext,
  userId: string,
  scope: AccessRequestScope,
  target: AccessRequestTarget,
  catalog: AccessRequestCatalog,
  preloaded?: Awaited<ReturnType<typeof loadAccessRequestPolicy>>,
  includeDelta = true
) {
  const canonical = validateAccessRequestTarget(target, catalog)
  const description = canonical && describeAccessRequestTarget(canonical, catalog)
  const unavailable = (reason: string) => ({
    state: 'unavailable' as const,
    reason,
    group: null,
    delta: null,
    limit: null,
  })
  if (!canonical || !description || !isAccessRequestTargetInScope(canonical, scope, catalog))
    return unavailable('This item is unavailable in this context.')
  if (!context.organizationId) return unavailable('An organization administrator is required.')
  const deploymentReason = getAccessRequestDeploymentUnavailableReason(canonical)
  if (deploymentReason) return unavailable(deploymentReason)
  if (!permissionSatisfies(context.role, description.minimumRole))
    return unavailable('Your workspace role does not permit this action.')
  const policy = preloaded ?? (await loadAccessRequestPolicy(executor, context, userId))
  if (canonical.kind === 'usage_limit') {
    if (!isHosted) return unavailable('Member credit limits are unavailable for this deployment.')
    const limit = policy.limit
    return {
      state: limit ? ('requestable' as const) : ('allowed' as const),
      reason: limit ? 'An organization administrator set your credit limit.' : null,
      group: null,
      delta: null,
      limit,
    }
  }
  if (!policy.entitled)
    return unavailable('Permission groups are unavailable for this organization.')
  const group = policy.group
  if (!group)
    return { state: 'allowed' as const, reason: null, group: null, delta: null, limit: null }
  const denied = isAccessRequestTargetDenied(canonical, group.config, catalog)
  const delta = includeDelta
    ? buildAccessRequestPolicyDelta(canonical, group.config, catalog)
    : null
  return {
    state: denied ? ('requestable' as const) : ('allowed' as const),
    reason: denied ? 'Restricted by your permission group.' : null,
    group,
    delta,
    limit: null,
  }
}
