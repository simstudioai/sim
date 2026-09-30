import { db } from '@sim/db'
import { permissions, project, projectWorkspace, workspace } from '@sim/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  assertOperationPrincipal,
  defineAuthorizedWorkspaceUseCase,
  defineOperation,
  defineWorkspaceOperation,
  type OperationUseCase,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const projectOperations = {
  /**
   * permission-group-exempt: lists only workspaces the caller already holds a permission on,
   * grouped into their projects; it grants and discloses nothing beyond those workspaces.
   */
  list: defineOperation({
    id: 'projects.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /**
   * permission-group-exempt: renames the grouping of workspaces the caller administers; no
   * workspace, resource or access changes.
   */
  rename: defineWorkspaceOperation({
    id: 'projects.rename',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const

export interface ProjectWorkspaceSummary {
  id: string
  name: string
  position: number
  forkedFromWorkspaceId: string | null
}

export interface ProjectSummary {
  id: string
  name: string
  organizationId: string | null
  workspaces: ProjectWorkspaceSummary[]
}

/**
 * The projects the user can see: every project with at least one active workspace the user
 * holds a permission on, listing only those workspaces, in pipeline order.
 */
async function listAccessibleProjects(
  userId: string,
  organizationId: string | undefined
): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      projectId: project.id,
      projectName: project.name,
      organizationId: project.organizationId,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      position: projectWorkspace.position,
      forkedFromWorkspaceId: workspace.forkedFromWorkspaceId,
    })
    .from(projectWorkspace)
    .innerJoin(project, eq(project.id, projectWorkspace.projectId))
    .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
    .innerJoin(
      permissions,
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspace.id),
        eq(permissions.userId, userId)
      )
    )
    .where(
      and(
        isNull(workspace.archivedAt),
        isNull(project.archivedAt),
        organizationId ? eq(project.organizationId, organizationId) : undefined
      )
    )
    .orderBy(
      asc(project.name),
      asc(project.id),
      asc(projectWorkspace.position),
      asc(workspace.name)
    )

  const projects = new Map<string, ProjectSummary>()
  for (const row of rows) {
    let entry = projects.get(row.projectId)
    if (!entry) {
      entry = {
        id: row.projectId,
        name: row.projectName,
        organizationId: row.organizationId,
        workspaces: [],
      }
      projects.set(row.projectId, entry)
    }
    if (entry.workspaces.some((w) => w.id === row.workspaceId)) continue
    entry.workspaces.push({
      id: row.workspaceId,
      name: row.workspaceName,
      position: row.position,
      forkedFromWorkspaceId: row.forkedFromWorkspaceId,
    })
  }
  return [...projects.values()]
}

export const listProjects: OperationUseCase<
  typeof projectOperations.list,
  { organizationId?: string },
  { projects: ProjectSummary[] }
> = {
  operation: projectOperations.list,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, projectOperations.list)
    return { projects: await listAccessibleProjects(principal.userId, input.organizationId) }
  },
}

interface RenameProjectInput {
  projectId: string
  name: string
}

/** The workspace that roots a project: renaming it takes admin there. */
async function resolveProjectRootContext(projectId: string) {
  const [root] = await db
    .select({ workspaceId: projectWorkspace.workspaceId })
    .from(projectWorkspace)
    .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
    .where(and(eq(projectWorkspace.projectId, projectId), isNull(workspace.archivedAt)))
    .orderBy(asc(projectWorkspace.position), asc(workspace.createdAt))
    .limit(1)
  if (!root) throw new OrchestrationError('not_found', 'Project not found')
  return resolveActiveWorkspaceApplicationContext(root.workspaceId)
}

export const renameProject = defineAuthorizedWorkspaceUseCase({
  operation: projectOperations.rename,
  resolveContext: ({ input }: { input: RenameProjectInput }) =>
    resolveProjectRootContext(input.projectId),
  authorizationOptions: {},
  execute: async ({ input }) => {
    const name = input.name.trim()
    const [renamed] = await db
      .update(project)
      .set({ name, updatedAt: new Date() })
      .where(eq(project.id, input.projectId))
      .returning({ id: project.id, name: project.name })
    if (!renamed) throw new OrchestrationError('not_found', 'Project not found')
    return { project: renamed }
  },
})
