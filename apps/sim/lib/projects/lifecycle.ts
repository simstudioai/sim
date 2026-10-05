import {
  project,
  projectWorkspace,
  workflow,
  workflowMcpServer,
  workflowMcpTool,
  workspace,
} from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbTransaction } from '@/lib/db/types'
import { lockProject } from '@/lib/projects/membership'
import { archiveWorkflowsInTransaction, finishWorkflowArchive } from '@/lib/workflows/lifecycle'
import { archiveWorkspaceInTransaction, finishWorkspaceArchive } from '@/lib/workspaces/lifecycle'

/** Bounds each batched archive statement's parameter list. */
const WORKFLOW_ARCHIVE_BATCH_SIZE = 1_000
/** Bounds concurrent post-commit notifications; each is best-effort and catches its own errors. */
const ARCHIVE_NOTIFICATION_CONCURRENCY = 8

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
    for (const batch of chunkArray(
      rows.map((row) => row.id),
      WORKFLOW_ARCHIVE_BATCH_SIZE
    )) {
      const tools = await tx
        .select({ workflowId: workflowMcpTool.workflowId, serverId: workflowMcpTool.serverId })
        .from(workflowMcpTool)
        .where(inArray(workflowMcpTool.workflowId, batch))
      const serverIdsByWorkflow = new Map<string, string[]>()
      for (const tool of tools) {
        const serverIds = serverIdsByWorkflow.get(tool.workflowId)
        if (serverIds) serverIds.push(tool.serverId)
        else serverIdsByWorkflow.set(tool.workflowId, [tool.serverId])
      }
      await archiveWorkflowsInTransaction(tx, batch, now)
      for (const id of batch)
        workflows.push({ id, workspaceId, serverIds: serverIdsByWorkflow.get(id) ?? [] })
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
  await mapWithConcurrency(effects.workflows, ARCHIVE_NOTIFICATION_CONCURRENCY, (row) =>
    finishWorkflowArchive(row.id, row.workspaceId, row.serverIds, { requestId })
  )
  for (const row of effects.environments) await finishWorkspaceArchive(row.id, row.serverIds)
}
