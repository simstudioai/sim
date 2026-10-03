import {
  project,
  projectWorkspace,
  workflow,
  workflowMcpServer,
  workflowMcpTool,
  workspace,
} from '@sim/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { lockProject } from '@/lib/projects/membership'
import { archiveWorkflowInTransaction, finishWorkflowArchive } from '@/lib/workflows/lifecycle'
import { archiveWorkspaceInTransaction, finishWorkspaceArchive } from '@/lib/workspaces/lifecycle'

/** All durable archive state commits together; external notifications follow the commit. */
export async function archiveProjectInTransaction(tx: DbTransaction, projectId: string) {
  await lockProject(tx, projectId)
  const [record] = await tx.select().from(project).where(eq(project.id, projectId))
  if (!record) throw new OrchestrationError('not_found', 'Project not found')
  const now = record.archivedAt ?? new Date()
  const members = await tx
    .select({ id: projectWorkspace.workspaceId })
    .from(projectWorkspace)
    .where(eq(projectWorkspace.projectId, projectId))
    .orderBy(asc(projectWorkspace.workspaceId))
  const workflows: { id: string; workspaceId: string; serverIds: string[] }[] = []
  const environments: { id: string; serverIds: string[] }[] = []
  for (const { id: workspaceId } of members) {
    await tx
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .for('update')
    const rows = await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
      .orderBy(asc(workflow.id))
    for (const row of rows) {
      const servers = await tx
        .select({ id: workflowMcpTool.serverId })
        .from(workflowMcpTool)
        .where(eq(workflowMcpTool.workflowId, row.id))
      await archiveWorkflowInTransaction(tx, row.id, now)
      workflows.push({ id: row.id, workspaceId, serverIds: servers.map((server) => server.id) })
    }
    const servers = await tx
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.workspaceId, workspaceId))
    await archiveWorkspaceInTransaction(tx, workspaceId, now)
    environments.push({ id: workspaceId, serverIds: servers.map((server) => server.id) })
  }
  await tx.update(project).set({ archivedAt: now, updatedAt: now }).where(eq(project.id, projectId))
  return { workflows, environments }
}

export async function finishProjectArchive(
  effects: Awaited<ReturnType<typeof archiveProjectInTransaction>>,
  requestId: string
): Promise<void> {
  for (const row of effects.workflows)
    await finishWorkflowArchive(row.id, row.workspaceId, row.serverIds, { requestId })
  for (const row of effects.environments) await finishWorkspaceArchive(row.id, row.serverIds)
}
