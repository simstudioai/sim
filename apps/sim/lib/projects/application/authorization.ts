import {
  type Principal,
  type ResourceDelegatedPrincipal,
  requirePrincipalSubjectUserId,
  type SessionPrincipal,
} from '@sim/auth/principal'
import { member, permissions, project, projectWorkspace, workspace } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { CAPABILITY_RULES, refuseCapability } from '@/lib/permission-groups/capabilities'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { resolveVerifiedUserAccessControlContext } from '@/lib/permission-groups/resolve.server'
import {
  PROJECT_DISCOVERY_DELEGATION_TTL_MS,
  type ProjectOperation,
} from '@/lib/projects/application/operations'
import { lockProject } from '@/lib/projects/membership'

export function requireProjectPrincipal<
  O extends Pick<ProjectOperation, 'id' | 'principalKinds' | 'delegationAudience'>,
>(
  principal: Principal,
  operation: O
): asserts principal is Extract<Principal, { kind: O['principalKinds'][number] }> {
  if (!operation.principalKinds.some((kind) => kind === principal.kind))
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
  if (principal.kind === 'resource_delegated') {
    if (operation.id !== 'projects.list' || !operation.delegationAudience)
      throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
    requireResourceDelegation(principal, {
      audience: operation.delegationAudience,
      services: ['copilot'],
      scope: { kind: 'project_discovery' },
      maxTtlMs: PROJECT_DISCOVERY_DELEGATION_TTL_MS,
    })
  }
}

/** Loads canonical membership for Project operations; callers enforce their own resource policy. */
export async function loadProjectAccess(
  tx: DbTransaction,
  userId: string,
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
        .where(and(eq(member.userId, userId), eq(member.organizationId, record.organizationId)))
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
      allowPersonalApiKeys: workspace.allowPersonalApiKeys,
    })
    .from(projectWorkspace)
    .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
    .where(eq(projectWorkspace.projectId, record.id))
    .orderBy(asc(workspace.id))
    .for('share', { of: workspace })
  if (environments.some((row) => row.organizationId !== record.organizationId))
    throw new OrchestrationError('conflict', 'Project ownership needs reconciliation')
  const grants = environments.length
    ? await tx
        .select({ id: permissions.entityId, permission: permissions.permissionType })
        .from(permissions)
        .where(
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.userId, userId),
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
  const active = rows.filter((row) => !row.archivedAt)
  const visible = active.filter((row) => orgAdmin || row.permission !== null)
  const canAdminister =
    orgAdmin || (rows.length > 0 && rows.every((row) => row.permission === 'admin'))
  if (!visible.length && !(record.archivedAt && canAdminister))
    throw new OrchestrationError('not_found', 'Project not found')
  if (input.workspaceId && !visible.some((row) => row.id === input.workspaceId))
    throw new OrchestrationError('not_found', 'Project not found')

  return { record, rows, active, visible, orgAdmin, canAdminister }
}

/** The complete environment set is loaded server-side; hidden environments never enter the result. */
export async function authorizeProject(
  tx: DbTransaction,
  principal: SessionPrincipal | ResourceDelegatedPrincipal,
  operation: ProjectOperation,
  input: { projectId: string; organizationId?: string; workspaceId?: string }
) {
  requireProjectPrincipal(principal, operation)
  const userId = requirePrincipalSubjectUserId(principal)
  const { record, rows, active, visible, canAdminister } = await loadProjectAccess(
    tx,
    userId,
    input
  )
  if (operation.access === 'issues' && record.organizationId)
    await acquirePermissionGroupOrgLock(tx, record.organizationId)
  if (operation.access === 'admin' && !canAdminister)
    throw new OrchestrationError(
      'forbidden',
      'Organization admin or admin access to every environment is required'
    )
  let canUseIssues = !record.archivedAt && visible.length > 0
  if (canUseIssues && visible.length < active.length && record.organizationId) {
    for (const environment of visible) {
      const { config } = await resolveVerifiedUserAccessControlContext(
        userId,
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
