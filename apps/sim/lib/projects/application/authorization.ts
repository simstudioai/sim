import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import { member, permissions, project, projectWorkspace, workspace } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { CAPABILITY_RULES, refuseCapability } from '@/lib/permission-groups/capabilities'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { resolveVerifiedUserAccessControlContext } from '@/lib/permission-groups/resolve.server'
import type { ProjectOperation } from '@/lib/projects/application/operations'
import { lockProject } from '@/lib/projects/membership'

export function requireProjectPrincipal(
  principal: Principal,
  operation: ProjectOperation
): asserts principal is SessionPrincipal {
  if (principal.kind !== 'session')
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
}

/** The complete environment set is loaded server-side; hidden environments never enter the result. */
export async function authorizeProject(
  tx: DbTransaction,
  principal: SessionPrincipal,
  operation: ProjectOperation,
  input: { projectId: string; organizationId?: string; workspaceId?: string }
) {
  await lockProject(tx, input.projectId)
  const [record] = await tx.select().from(project).where(eq(project.id, input.projectId)).limit(1)
  if (
    !record ||
    (input.organizationId !== undefined && input.organizationId !== record.organizationId)
  ) {
    throw new OrchestrationError('not_found', 'Project not found')
  }
  const [orgMember] = record.organizationId
    ? await tx
        .select({ role: member.role })
        .from(member)
        .where(
          and(eq(member.userId, principal.userId), eq(member.organizationId, record.organizationId))
        )
        .limit(1)
        .for('share')
    : []
  const orgAdmin = isOrgAdminRole(orgMember?.role)
  const environments = await tx
    .select({
      id: workspace.id,
      name: workspace.name,
      organizationId: workspace.organizationId,
      archivedAt: workspace.archivedAt,
      parentId: workspace.forkedFromWorkspaceId,
    })
    .from(projectWorkspace)
    .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
    .where(eq(projectWorkspace.projectId, record.id))
    .orderBy(asc(workspace.id))
  if (environments.some((row) => row.organizationId !== record.organizationId))
    throw new OrchestrationError('conflict', 'Project ownership needs reconciliation')
  const grants = environments.length
    ? await tx
        .select({ id: permissions.entityId, permission: permissions.permissionType })
        .from(permissions)
        .where(
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.userId, principal.userId),
            inArray(
              permissions.entityId,
              environments.map((row) => row.id)
            )
          )
        )
        .orderBy(asc(permissions.entityId))
        .for('share')
    : []
  const grantsById = new Map(grants.map((row) => [row.id, row.permission]))
  const rows = environments.map((row) => ({ ...row, permission: grantsById.get(row.id) ?? null }))
  if (operation.access === 'issues' && record.organizationId)
    await acquirePermissionGroupOrgLock(tx, record.organizationId)
  const active = rows.filter((row) => !row.archivedAt)
  const visible = active.filter((row) => orgAdmin || row.permission !== null)
  const canAdminister =
    orgAdmin || (rows.length > 0 && rows.every((row) => row.permission === 'admin'))
  if (!visible.length && !(record.archivedAt && canAdminister))
    throw new OrchestrationError('not_found', 'Project not found')
  if (input.workspaceId && !visible.some((row) => row.id === input.workspaceId))
    throw new OrchestrationError('not_found', 'Project not found')
  if (operation.access === 'admin' && !canAdminister)
    throw new OrchestrationError(
      'forbidden',
      'Organization admin or admin access to every environment is required'
    )
  let canUseIssues = !record.archivedAt && visible.length > 0
  if (canUseIssues && visible.length < active.length && record.organizationId) {
    for (const environment of visible) {
      const { config } = await resolveVerifiedUserAccessControlContext(
        principal.userId,
        environment.id,
        record.organizationId,
        tx
      )
      if (config && CAPABILITY_RULES['project_issues.use'].deniedBy(config, record.id)) {
        canUseIssues = false
        break
      }
    }
  }
  // permission-group-enforced: project_issues.use — Project-wide all-or-nothing gate follows current environment access.
  if (operation.access === 'issues' && !canUseIssues) {
    if (record.archivedAt) throw new OrchestrationError('conflict', 'Project is archived')
    refuseCapability('project_issues.use')
  }
  const visibleIds = new Set(visible.map((row) => row.id))
  return {
    record,
    environmentIds: rows.map((row) => row.id),
    canAdminister,
    canUseIssues,
    environments: visible.map((row) => ({
      id: row.id,
      name: row.name,
      forkedFromWorkspaceId: row.parentId && visibleIds.has(row.parentId) ? row.parentId : null,
    })),
  }
}
