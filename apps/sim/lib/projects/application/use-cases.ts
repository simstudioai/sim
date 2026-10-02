import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { member, permissions, project, projectWorkspace, workspace } from '@sim/db/schema'
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { authorizeProject, requireProjectPrincipal } from '@/lib/projects/application/authorization'
import { projectOperations } from '@/lib/projects/application/operations'
import { archiveProjectInTransaction, finishProjectArchive } from '@/lib/projects/lifecycle'
import { requireProjectApiEnabled } from '@/lib/projects/rollout.server'

interface ProjectInput {
  projectId: string
  organizationId?: string
  workspaceId?: string
}
type ProjectContext = Awaited<ReturnType<typeof authorizeProject>>
function presentProject(context: ProjectContext) {
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
    requireProjectApiEnabled()
    return db.transaction(async (tx) => ({
      project: presentProject(await authorizeProject(tx, principal, projectOperations.get, input)),
    }))
  },
}

/** Read-only capability probe. Issue mutations call authorizeProject inside their own transaction. */
export const getProjectIssueAccess: OperationUseCase<
  typeof projectOperations.issues,
  ProjectInput,
  { projectId: string }
> = {
  operation: projectOperations.issues,
  async execute({ principal, input }) {
    requireProjectPrincipal(principal, projectOperations.issues)
    requireProjectApiEnabled()
    return db.transaction(async (tx) => {
      const context = await authorizeProject(tx, principal, projectOperations.issues, input)
      return { projectId: context.record.id }
    })
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
    requireProjectApiEnabled()
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
      throw new OrchestrationError('validation', 'Limit must be between 1 and 100')
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            isNull(project.archivedAt),
            input.organizationId ? eq(project.organizationId, input.organizationId) : undefined,
            input.cursor ? gt(project.id, input.cursor) : undefined,
            sql`exists (select 1 from ${projectWorkspace} pw join ${workspace} w on w.id = pw.workspace_id
          where pw.project_id = ${project.id} and w.archived_at is null and (
            exists (select 1 from ${permissions} pe where pe.entity_type = 'workspace' and pe.entity_id = w.id and pe.user_id = ${principal.userId})
            or exists (select 1 from ${member} m where m.organization_id = w.organization_id and m.user_id = ${principal.userId} and m.role in ('owner', 'admin'))
          ))`
          )
        )
        .orderBy(asc(project.id))
        .limit(input.limit + 1)
      const page = candidates.slice(0, input.limit)
      const projects = []
      for (const row of page)
        projects.push(
          presentProject(
            await authorizeProject(tx, principal, projectOperations.list, {
              projectId: row.id,
              organizationId: input.organizationId,
            })
          )
        )
      return {
        projects,
        nextCursor: candidates.length > input.limit ? (page.at(-1)?.id ?? null) : null,
      }
    })
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
    requireProjectApiEnabled()
    const name = input.name.trim()
    if (!name || name.length > 100)
      throw new OrchestrationError('validation', 'Project name must contain 1–100 characters')
    const result = await db.transaction(async (tx) => {
      const context = await authorizeProject(tx, principal, projectOperations.rename, input)
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
    requireProjectApiEnabled()
    const result = await db.transaction(async (tx) => {
      const context = await authorizeProject(tx, principal, projectOperations.archive, input)
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
    requireProjectApiEnabled()
    return db.transaction(async (tx) => {
      const [membership] = await tx
        .select({ projectId: projectWorkspace.projectId })
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, input.workspaceId))
        .limit(1)
      if (!membership) throw new OrchestrationError('not_found', 'Project not found')
      return {
        project: presentProject(
          await authorizeProject(tx, principal, projectOperations.get, {
            projectId: membership.projectId,
            workspaceId: input.workspaceId,
          })
        ),
      }
    })
  },
}
