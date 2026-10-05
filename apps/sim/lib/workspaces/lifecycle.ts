import { db } from '@sim/db'
import {
  apiKey,
  document,
  invitation,
  invitationWorkspaceGrant,
  knowledgeBase,
  knowledgeConnector,
  mcpServers,
  userTableDefinitions,
  workflowMcpServer,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { mcpService } from '@/lib/mcp/service'
import { archiveProjectWithLastEnvironment, lockWorkspaceProject } from '@/lib/projects/membership'
import { archiveWorkflowsForWorkspace } from '@/lib/workflows/lifecycle'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceLifecycle')

interface ArchiveWorkspaceOptions {
  requestId: string
  expectedOwnerId?: string
}

interface ArchiveWorkspaceResult {
  archived: boolean
  workspaceName?: string
  /** The Project archived with its last active environment, for the caller's audit. */
  archivedProject?: { id: string; name: string }
}

export async function archiveWorkspace(
  workspaceId: string,
  options: ArchiveWorkspaceOptions
): Promise<ArchiveWorkspaceResult> {
  const workspaceRecord = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })

  if (!workspaceRecord) {
    return { archived: false }
  }

  /** Retrying deletion also archives children left active by an older or incomplete deletion. */
  const now = workspaceRecord.archivedAt ?? new Date()
  const workflowMcpServerIds = await db
    .select({ id: workflowMcpServer.id })
    .from(workflowMcpServer)
    .where(eq(workflowMcpServer.workspaceId, workspaceId))

  const outcome = await db.transaction(async (tx) => {
    const owningProject = await lockWorkspaceProject(tx, workspaceId)
    if (options.expectedOwnerId) {
      const [current] = await tx
        .select({ ownerId: workspace.ownerId })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .for('no key update')
      if (!current || current.ownerId !== options.expectedOwnerId) return null
    }
    const projectArchived =
      owningProject !== null &&
      (await archiveProjectWithLastEnvironment(tx, owningProject.id, workspaceId, now))
    await archiveWorkspaceInTransaction(tx, workspaceId, now)
    return { archivedProject: projectArchived ? owningProject : null }
  })
  if (!outcome) return { archived: false }

  await archiveWorkflowsForWorkspace(workspaceId, options)

  logger.info(`[${options.requestId}] Archived workspace ${workspaceId}`)

  await finishWorkspaceArchive(
    workspaceId,
    workflowMcpServerIds.map((server) => server.id)
  )

  return {
    archived: !workspaceRecord.archivedAt,
    workspaceName: workspaceRecord.name,
    ...(outcome.archivedProject
      ? {
          archivedProject: { id: outcome.archivedProject.id, name: outcome.archivedProject.name },
        }
      : {}),
  }
}

/** Durable environment archive changes; callers own the Project lifecycle. */
export async function archiveWorkspaceInTransaction(
  tx: DbTransaction,
  workspaceId: string,
  now: Date
): Promise<void> {
  await tx
    .update(knowledgeBase)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))

  const workspaceKbIds = await tx
    .select({ id: knowledgeBase.id })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.workspaceId, workspaceId))

  const knowledgeBaseIds = workspaceKbIds.map((entry) => entry.id)
  if (knowledgeBaseIds.length > 0) {
    await tx
      .update(document)
      .set({ archivedAt: now })
      .where(
        and(
          inArray(document.knowledgeBaseId, knowledgeBaseIds),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )

    await tx
      .update(knowledgeConnector)
      .set({ archivedAt: now, status: 'paused', updatedAt: now })
      .where(
        and(
          inArray(knowledgeConnector.knowledgeBaseId, knowledgeBaseIds),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
  }

  await tx
    .update(userTableDefinitions)
    .set({
      archivedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )

  await tx
    .update(workspaceFiles)
    .set({
      deletedAt: now,
    })
    .where(and(eq(workspaceFiles.workspaceId, workspaceId), isNull(workspaceFiles.deletedAt)))

  await tx
    .update(invitation)
    .set({
      status: 'cancelled',
      updatedAt: now,
    })
    .where(
      and(
        eq(invitation.status, 'pending'),
        sql`${invitation.id} IN (
            SELECT ${invitationWorkspaceGrant.invitationId}
            FROM ${invitationWorkspaceGrant}
            WHERE ${invitationWorkspaceGrant.workspaceId} = ${workspaceId}
          )`
      )
    )

  await tx
    .delete(apiKey)
    .where(and(eq(apiKey.workspaceId, workspaceId), eq(apiKey.type, 'workspace')))

  await tx
    .update(workflowMcpServer)
    .set({
      deletedAt: now,
      isPublic: false,
      updatedAt: now,
    })
    .where(eq(workflowMcpServer.workspaceId, workspaceId))

  await tx
    .update(mcpServers)
    .set({
      deletedAt: now,
      enabled: false,
      updatedAt: now,
    })
    .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))

  await tx
    .update(workspace)
    .set({
      archivedAt: now,
      updatedAt: now,
    })
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
}

/** Refreshes derived MCP state after the archive transaction commits. */
export async function finishWorkspaceArchive(
  workspaceId: string,
  serverIds: string[]
): Promise<void> {
  await mcpService.clearCache(workspaceId).catch(() => undefined)
  if (mcpPubSub) {
    for (const serverId of serverIds)
      mcpPubSub.publishWorkflowToolsChanged({ serverId, workspaceId })
  }
}
