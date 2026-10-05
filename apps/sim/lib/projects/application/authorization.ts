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
import { type ProjectOperation, projectOperations } from '@/lib/projects/application/operations'
import { lockProject } from '@/lib/projects/membership'

export function requireProjectPrincipal(
  principal: Principal,
  operation: Pick<ProjectOperation, 'id' | 'principalKinds'>
): asserts principal is SessionPrincipal {
  if (principal.kind !== 'session')
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
}

type ProjectRecord = typeof project.$inferSelect

interface ProjectEnvironmentAccess {
  id: string
  name: string
  organizationId: string | null
  archivedAt: Date | null
  parentId: string | null
  permission: string | null
}

interface ProjectAuthorizationInput {
  organizationId?: string
  workspaceId?: string
}

/**
 * `hold` locks the Project and the rows the decision reads until commit, for callers that
 * act on it. `snapshot` takes no locks and relies on the caller's read-only snapshot.
 */
export type ProjectAccessMode = 'hold' | 'snapshot'

type ProjectAccess = Awaited<ReturnType<typeof loadProjectAccess>>

/**
 * Loads the caller's org role and every environment with its grant for `records` in three
 * queries, whatever their count.
 */
async function loadProjectAccess(
  tx: DbTransaction,
  userId: string,
  records: ProjectRecord[],
  mode: ProjectAccessMode
) {
  const lock = mode === 'hold'
  const memberQuery = tx
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)
  const [membership] = records.some((record) => record.organizationId)
    ? await (lock ? memberQuery.for('share') : memberQuery)
    : []
  const environments = await tx
    .select({
      projectId: projectWorkspace.projectId,
      id: workspace.id,
      name: workspace.name,
      organizationId: workspace.organizationId,
      archivedAt: workspace.archivedAt,
      parentId: workspace.forkedFromWorkspaceId,
    })
    .from(projectWorkspace)
    .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
    .where(
      inArray(
        projectWorkspace.projectId,
        records.map((record) => record.id)
      )
    )
    .orderBy(asc(workspace.id))
  const grantQuery = tx
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
  const grants = environments.length ? await (lock ? grantQuery.for('share') : grantQuery) : []
  const grantsById = new Map(grants.map((row) => [row.id, row.permission]))
  const environmentsByProject = new Map<string, ProjectEnvironmentAccess[]>()
  for (const { projectId, ...row } of environments) {
    const access = { ...row, permission: grantsById.get(row.id) ?? null }
    const rows = environmentsByProject.get(projectId)
    if (rows) rows.push(access)
    else environmentsByProject.set(projectId, [access])
  }
  return {
    isOrgAdmin: (organizationId: string | null) =>
      organizationId !== null &&
      membership?.organizationId === organizationId &&
      isOrgAdminRole(membership.role),
    environmentsFor: (projectId: string) => environmentsByProject.get(projectId) ?? [],
  }
}

/** Applies the access rules to one loaded Project; hidden environments never enter the result. */
async function evaluateProjectAccess(
  tx: DbTransaction,
  principal: SessionPrincipal,
  operation: ProjectOperation,
  record: ProjectRecord,
  access: ProjectAccess,
  input: ProjectAuthorizationInput,
  mode: ProjectAccessMode
) {
  const orgAdmin = access.isOrgAdmin(record.organizationId)
  const rows = access.environmentsFor(record.id)
  if (rows.some((row) => row.organizationId !== record.organizationId))
    throw new OrchestrationError('conflict', 'Project ownership needs reconciliation')
  if (mode === 'hold' && operation.access === 'issues' && record.organizationId)
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
    canAdminister,
    canUseIssues,
    environments: visible.map((row) => ({
      id: row.id,
      name: row.name,
      forkedFromWorkspaceId: row.parentId && visibleIds.has(row.parentId) ? row.parentId : null,
    })),
  }
}

export type AuthorizedProject = Awaited<ReturnType<typeof evaluateProjectAccess>>

/** Authorizes one Project for `operation`; see {@link ProjectAccessMode} for locking. */
export async function authorizeProject(
  tx: DbTransaction,
  principal: SessionPrincipal,
  operation: ProjectOperation,
  input: ProjectAuthorizationInput & { projectId: string },
  mode: ProjectAccessMode
): Promise<AuthorizedProject> {
  if (mode === 'hold') await lockProject(tx, input.projectId)
  const [record] = await tx.select().from(project).where(eq(project.id, input.projectId)).limit(1)
  if (
    !record ||
    (input.organizationId !== undefined && input.organizationId !== record.organizationId)
  ) {
    throw new OrchestrationError('not_found', 'Project not found')
  }
  const access = await loadProjectAccess(tx, principal.userId, [record], mode)
  return evaluateProjectAccess(tx, principal, operation, record, access, input, mode)
}

/** Authorizes a listed page of Projects in id order inside the caller's read-only snapshot. */
export async function authorizeProjectsForRead(
  tx: DbTransaction,
  principal: SessionPrincipal,
  projectIds: string[]
): Promise<AuthorizedProject[]> {
  if (!projectIds.length) return []
  const records = await tx
    .select()
    .from(project)
    .where(inArray(project.id, projectIds))
    .orderBy(asc(project.id))
  const access = await loadProjectAccess(tx, principal.userId, records, 'snapshot')
  const authorized: AuthorizedProject[] = []
  for (const record of records) {
    authorized.push(
      await evaluateProjectAccess(
        tx,
        principal,
        projectOperations.list,
        record,
        access,
        {},
        'snapshot'
      )
    )
  }
  return authorized
}
