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
  workflowSchedule,
  workspace,
  workspaceFiles,
  workspaceNotificationSubscription,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { mcpService } from '@/lib/mcp/service'
import { archiveWorkflowsForWorkspace } from '@/lib/workflows/lifecycle'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceLifecycle')

interface ArchiveWorkspaceOptions {
  requestId: string
}

export async function archiveWorkspace(
  workspaceId: string,
  options: ArchiveWorkspaceOptions
): Promise<{ archived: boolean; workspaceName?: string }> {
  const workspaceRecord = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })

  if (!workspaceRecord) {
    return { archived: false }
  }

  if (workspaceRecord.archivedAt) {
    await archiveWorkflowsForWorkspace(workspaceId, options)
    return { archived: false, workspaceName: workspaceRecord.name }
  }

  const now = new Date()
  const workflowMcpServerIds = await db
    .select({ id: workflowMcpServer.id })
    .from(workflowMcpServer)
    .where(eq(workflowMcpServer.workspaceId, workspaceId))

  await db.transaction(async (tx) => {
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
      .update(workspaceNotificationSubscription)
      .set({
        active: false,
        updatedAt: now,
      })
      .where(eq(workspaceNotificationSubscription.workspaceId, workspaceId))

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
      .update(workflowSchedule)
      .set({
        archivedAt: now,
        updatedAt: now,
        status: 'disabled',
        nextRunAt: null,
        lastQueuedAt: null,
      })
      .where(
        and(
          eq(workflowSchedule.sourceWorkspaceId, workspaceId),
          eq(workflowSchedule.sourceType, 'job'),
          isNull(workflowSchedule.archivedAt)
        )
      )

    await tx
      .update(workspace)
      .set({
        archivedAt: now,
        updatedAt: now,
      })
      .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
  })

  await archiveWorkflowsForWorkspace(workspaceId, options)

  logger.info(`[${options.requestId}] Archived workspace ${workspaceId}`)

  await mcpService.clearCache(workspaceId).catch(() => undefined)

  if (mcpPubSub && workflowMcpServerIds.length > 0) {
    for (const server of workflowMcpServerIds) {
      mcpPubSub.publishWorkflowToolsChanged({
        serverId: server.id,
        workspaceId,
      })
    }
  }

  return {
    archived: true,
    workspaceName: workspaceRecord.name,
  }
}
