import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, permissions, project, projectWorkspace, workspace } from '@sim/db/schema'
import { ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { eq, inArray, sql } from 'drizzle-orm'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type AuthorizedProject,
  authorizeProject,
  authorizeProjectsForRead,
  type ProjectAuthorizationInput,
  requireProjectPrincipal,
} from '@/lib/projects/application/authorization'
import { resolveCopilotProjectScope } from '@/lib/projects/application/discovery'
import { projectOperations } from '@/lib/projects/application/operations'
import { archiveProjectInTransaction, finishProjectArchive } from '@/lib/projects/lifecycle'
import { requireProjectApiEnabled } from '@/lib/projects/rollout.server'

type ProjectInput = ProjectAuthorizationInput & { projectId: string }
/** Reads see one consistent snapshot without locking the rows writers need. */
const READ_SNAPSHOT = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const

function presentProject(context: AuthorizedProject) {
  return {
    ...context.record,
    environments: context.environments,
    capabilities: { administer: context.canAdminister, issues: context.canUseIssues },
  }
}

export const getProject: OperationUseCase<
  typeof projectOperations.get,
  ProjectInput,
  { project: ReturnType<typeof presentProject> }
> = {
  operation: projectOperations.get,
  async execute({ principal, input }) {
    requireProjectPrincipal(principal, projectOperations.get)
    await requireProjectApiEnabled()
    return db.transaction(
      async (tx) => ({
        project: presentProject(
          await authorizeProject(tx, principal, projectOperations.get, input, 'snapshot')
        ),
      }),
      READ_SNAPSHOT
    )
  },
}

/**
 * Read-only capability probe. Issue mutations call authorizeProject in `hold` mode
 * inside their own transaction.
 */
export const getProjectIssueAccess: OperationUseCase<
  typeof projectOperations.issues,
  ProjectInput,
  { projectId: string }
> = {
  operation: projectOperations.issues,
  async execute({ principal, input }) {
    requireProjectPrincipal(principal, projectOperations.issues)
    await requireProjectApiEnabled()
    return db.transaction(async (tx) => {
      const context = await authorizeProject(
        tx,
        principal,
        projectOperations.issues,
        input,
        'snapshot'
      )
      return { projectId: context.record.id }
    }, READ_SNAPSHOT)
  },
}

export const listProjects: OperationUseCase<
  typeof projectOperations.list,
  { organizationId?: string; cursor?: string; limit: number },
  { projects: ReturnType<typeof presentProject>[]; nextCursor: string | null }
> = {
  operation: projectOperations.list,
  async execute({ principal, input }) {
    requireProjectPrincipal(principal, projectOperations.list)
    await requireProjectApiEnabled()
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
      throw new OrchestrationError('validation', 'Limit must be between 1 and 100')
    const userId = requirePrincipalSubjectUserId(principal)
    const scope =
      principal.kind === 'resource_delegated'
        ? await resolveCopilotProjectScope(principal, input.organizationId)
        : { organizationId: input.organizationId, projectId: undefined }
    return db.transaction(async (tx) => {
      /** Driven from the caller's grants and admin organization, so cost tracks their reach. */
      const candidates = await tx.execute<{ id: string }>(sql`
        WITH accessible AS (
          SELECT ${permissions.entityId} AS workspace_id FROM ${permissions}
          WHERE ${permissions.userId} = ${userId}
            AND ${permissions.entityType} = 'workspace'
          UNION
          SELECT ${workspace.id} FROM ${member}
          JOIN ${workspace} ON ${workspace.organizationId} = ${member.organizationId}
          WHERE ${member.userId} = ${userId} AND ${inArray(member.role, ORG_ADMIN_ROLES)}
        )
        SELECT DISTINCT ${projectWorkspace.projectId} AS id
        FROM accessible
        JOIN ${projectWorkspace} ON ${projectWorkspace.workspaceId} = accessible.workspace_id
        JOIN ${workspace}
          ON ${workspace.id} = accessible.workspace_id AND ${workspace.archivedAt} IS NULL
        JOIN ${project}
          ON ${project.id} = ${projectWorkspace.projectId} AND ${project.archivedAt} IS NULL
        WHERE TRUE
          ${scope.organizationId ? sql`AND ${project.organizationId} = ${scope.organizationId}` : sql``}
          ${scope.projectId ? sql`AND ${project.id} = ${scope.projectId}` : sql``}
          ${input.cursor ? sql`AND ${projectWorkspace.projectId} > ${input.cursor}` : sql``}
        ORDER BY 1
        LIMIT ${input.limit + 1}
      `)
      const page = candidates.slice(0, input.limit).map((row) => row.id)
      const projects = await authorizeProjectsForRead(tx, principal, page)
      return {
        projects: projects.map(presentProject),
        nextCursor: candidates.length > input.limit ? (page.at(-1) ?? null) : null,
      }
    }, READ_SNAPSHOT)
  },
}

export const renameProject: OperationUseCase<
  typeof projectOperations.rename,
  ProjectInput & { name: string },
  { id: string; name: string }
> = {
  operation: projectOperations.rename,
  async execute({ principal, input, request }) {
    requireProjectPrincipal(principal, projectOperations.rename)
    await requireProjectApiEnabled()
    const { name } = input
    const result = await db.transaction(async (tx) => {
      const context = await authorizeProject(tx, principal, projectOperations.rename, input, 'hold')
      if (context.record.archivedAt) throw new OrchestrationError('conflict', 'Project is archived')
      if (context.record.name === name) return { context, changed: false }
      await tx
        .update(project)
        .set({ name, updatedAt: new Date() })
        .where(eq(project.id, context.record.id))
      return { context, changed: true }
    })
    if (result.changed)
      recordProjectedUseCaseAuditEntries(
        projectOperations.rename,
        null,
        principal,
        request,
        [
          {
            action: AuditAction.PROJECT_UPDATED,
            resourceType: AuditResourceType.PROJECT,
            resourceId: input.projectId,
            resourceName: name,
          },
        ],
        result.context.record.organizationId ?? undefined
      )
    return { id: input.projectId, name }
  },
}

export const archiveProject: OperationUseCase<
  typeof projectOperations.archive,
  ProjectInput,
  { id: string; archived: boolean }
> = {
  operation: projectOperations.archive,
  async execute({ principal, input, request }) {
    requireProjectPrincipal(principal, projectOperations.archive)
    await requireProjectApiEnabled()
    const result = await db.transaction(async (tx) => {
      const context = await authorizeProject(
        tx,
        principal,
        projectOperations.archive,
        input,
        'hold'
      )
      const effects = await archiveProjectInTransaction(tx, context.record.id)
      return { context, effects }
    })
    if (!result.context.record.archivedAt)
      recordProjectedUseCaseAuditEntries(
        projectOperations.archive,
        null,
        principal,
        request,
        [
          {
            action: AuditAction.PROJECT_ARCHIVED,
            resourceType: AuditResourceType.PROJECT,
            resourceId: input.projectId,
            resourceName: result.context.record.name,
          },
        ],
        result.context.record.organizationId ?? undefined
      )
    await finishProjectArchive(result.effects, `project:${input.projectId}`)
    return { id: input.projectId, archived: true }
  },
}

/** Resolves membership and authorizes the requested environment before returning Project data. */
export const getWorkspaceProject: OperationUseCase<
  typeof projectOperations.get,
  { workspaceId: string },
  { project: ReturnType<typeof presentProject> }
> = {
  operation: projectOperations.get,
  async execute({ principal, input }) {
    requireProjectPrincipal(principal, projectOperations.get)
    await requireProjectApiEnabled()
    return db.transaction(async (tx) => {
      const [membership] = await tx
        .select({ projectId: projectWorkspace.projectId })
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, input.workspaceId))
        .limit(1)
      if (!membership) throw new OrchestrationError('not_found', 'Project not found')
      return {
        project: presentProject(
          await authorizeProject(
            tx,
            principal,
            projectOperations.get,
            {
              projectId: membership.projectId,
              workspaceId: input.workspaceId,
            },
            'snapshot'
          )
        ),
      }
    }, READ_SNAPSHOT)
  },
}
