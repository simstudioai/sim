import { db } from '@sim/db'
import { project, projectWorkspace, workspace } from '@sim/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ProjectApi } from '@/lib/api/contracts/projects'
import { defineAuthorizedOrganizationUseCase } from '@/lib/core/application/authorized-organization-use-case'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

/** permission-group-exempt: Organization admins need the project inventory to configure access itself. */
export const listOrganizationProjectsOperation = defineOrganizationOperation({
  id: 'projects.list_for_organization_admin',
  minimumRole: 'admin',
  principalKinds: ['session'],
  capability: 'none',
})

/** Canonical organization inventory; callers must authorize organization administration first. */
export async function listOrganizationProjectRecords(
  organizationId: string
): Promise<ProjectApi[]> {
  const rows = await db
    .select({
      projectId: project.id,
      projectName: project.name,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      position: projectWorkspace.position,
      forkedFromWorkspaceId: workspace.forkedFromWorkspaceId,
    })
    .from(project)
    .innerJoin(projectWorkspace, eq(projectWorkspace.projectId, project.id))
    .innerJoin(
      workspace,
      and(
        eq(workspace.id, projectWorkspace.workspaceId),
        eq(workspace.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(project.organizationId, organizationId),
        isNull(project.archivedAt),
        isNull(workspace.archivedAt)
      )
    )
    .orderBy(
      asc(project.name),
      asc(project.id),
      asc(projectWorkspace.position),
      asc(workspace.name)
    )
  const projects = new Map<string, ProjectApi>()
  for (const row of rows) {
    let entry = projects.get(row.projectId)
    if (!entry) {
      entry = { id: row.projectId, name: row.projectName, organizationId, workspaces: [] }
      projects.set(row.projectId, entry)
    }
    entry.workspaces.push({
      id: row.workspaceId,
      name: row.workspaceName,
      position: row.position,
      forkedFromWorkspaceId: row.forkedFromWorkspaceId,
    })
  }
  return [...projects.values()]
}

export const listOrganizationProjects = defineAuthorizedOrganizationUseCase({
  operation: listOrganizationProjectsOperation,
  async execute({ context }) {
    return { projects: await listOrganizationProjectRecords(context.organizationId) }
  },
})
