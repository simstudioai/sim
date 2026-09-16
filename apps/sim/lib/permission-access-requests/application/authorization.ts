import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, permissions, user, workspace } from '@sim/db/schema'
import {
  isOrgAdminRole,
  type PermissionType,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import { and, eq, isNull } from 'drizzle-orm'
import { isAccountBlocked } from '@/lib/auth/ban'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import {
  authorizeWorkspaceOperation,
  requireAllowedWorkspacePrincipal,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import type { AccessRequestOperation } from '@/lib/permission-access-requests/application/operations'
import type { AccessRequestScope } from '@/lib/permission-groups/access-requests/targets'

export interface AccessRequestContext {
  organizationId: string | null
  workspaceId: string | null
  membershipId: string
  role: PermissionType
}

/** Reinvitation produces a new identity token, even when the same user regains access. */
export async function loadAccessRequestMembership(
  executor: DbOrTx,
  userId: string,
  scope: AccessRequestScope,
  organizationId: string | null,
  forUpdate = false
): Promise<{ membershipId: string; role: PermissionType } | null> {
  const personQuery = executor
    .select({ suspendedAt: user.suspendedAt, banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, userId))
  /** Shared account locks block suspension while allowing reciprocal external-member reviews. */
  const [person] = forUpdate ? await personQuery.for('share').limit(1) : await personQuery.limit(1)
  if (!person || isAccountBlocked(person)) return null
  const orgMember = organizationId
    ? await (async () => {
        const query = executor
          .select({ id: member.id, role: member.role })
          .from(member)
          .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
        const [row] = forUpdate ? await query.for('update').limit(1) : await query.limit(1)
        return row
      })()
    : undefined
  if (orgMember && !['member', 'admin', 'owner'].includes(orgMember.role)) return null
  if (scope.kind === 'organization') {
    if (!orgMember) return null
    return {
      membershipId: JSON.stringify([orgMember.id, null]),
      role: isOrgAdminRole(orgMember.role) ? 'admin' : 'read',
    }
  }
  const grantQuery = executor
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, scope.workspaceId)
      )
    )
  const [grant] = forUpdate ? await grantQuery.for('update').limit(1) : await grantQuery.limit(1)
  const role = await resolveEffectiveWorkspacePermission(
    userId,
    scope.workspaceId,
    organizationId,
    executor,
    { forUpdate }
  )
  if (!role) return null
  return { membershipId: JSON.stringify([orgMember?.id ?? null, grant?.id ?? null]), role }
}

/** Canonical scope and current role are loaded together on the transaction's connection. */
export async function authorizeAccessRequestScope(
  principal: SessionPrincipal,
  operation: AccessRequestOperation,
  scope: AccessRequestScope,
  executor: DbOrTx = db,
  forUpdate = false,
  expected?: Pick<AccessRequestContext, 'organizationId' | 'membershipId'>
): Promise<AccessRequestContext> {
  requireAllowedWorkspacePrincipal(principal, operation)
  if (operation.admin && scope.kind !== 'organization') {
    throw new OrchestrationError('forbidden', 'Organization administrator access is required')
  }
  let canonicalWorkspace:
    | Pick<typeof workspace.$inferSelect, 'id' | 'organizationId' | 'allowPersonalApiKeys'>
    | undefined
  let organizationId: string | null
  if (scope.kind === 'workspace') {
    const query = executor
      .select({
        id: workspace.id,
        organizationId: workspace.organizationId,
        allowPersonalApiKeys: workspace.allowPersonalApiKeys,
      })
      .from(workspace)
      .where(and(eq(workspace.id, scope.workspaceId), isNull(workspace.archivedAt)))
    const [row] = forUpdate ? await query.for('update').limit(1) : await query.limit(1)
    if (!row || (expected && row.organizationId !== expected.organizationId)) {
      throw new OrchestrationError('not_found', 'Workspace not found')
    }
    canonicalWorkspace = row
    organizationId = row.organizationId
  } else {
    organizationId = scope.organizationId
  }
  const membership = await loadAccessRequestMembership(
    executor,
    principal.userId,
    scope,
    organizationId,
    forUpdate
  )
  if (!membership || (expected && membership.membershipId !== expected.membershipId)) {
    throw new OrchestrationError('not_found', 'Access request scope not found')
  }
  if (canonicalWorkspace) {
    await authorizeWorkspaceOperation(
      principal,
      operation,
      {
        workspaceId: canonicalWorkspace.id,
        workspaceOrganizationId: canonicalWorkspace.organizationId,
        allowPersonalApiKeys: canonicalWorkspace.allowPersonalApiKeys,
      },
      { executor, forUpdate }
    )
  } else if (scope.kind === 'organization') {
    await authorizeOrganizationOperation(
      principal,
      operation.organizationOperation,
      { organizationId: scope.organizationId },
      { executor, forUpdate }
    )
  }
  return {
    organizationId,
    workspaceId: scope.kind === 'workspace' ? scope.workspaceId : null,
    ...membership,
  }
}
