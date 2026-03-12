import { db } from '@sim/db'
import {
  apiKey,
  knowledgeBase,
  userTableDefinitions,
  workflowMcpServer,
  workflowSchedule,
  workspace,
  workspaceFiles,
  workspaceInvitation,
  workspaceNotificationSubscription,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
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
    return { archived: false, workspaceName: workspaceRecord.name }
  }

  const now = new Date()

  await archiveWorkflowsForWorkspace(workspaceId, options)

  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeBase)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))

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
      .update(workspaceInvitation)
      .set({
        status: 'cancelled',
        updatedAt: now,
      })
      .where(
        and(
          eq(workspaceInvitation.workspaceId, workspaceId),
          eq(workspaceInvitation.status, 'pending')
        )
      )

    await tx
      .delete(apiKey)
      .where(and(eq(apiKey.workspaceId, workspaceId), eq(apiKey.type, 'workspace')))

    await tx
      .update(workflowMcpServer)
      .set({
        isPublic: false,
        updatedAt: now,
      })
      .where(eq(workflowMcpServer.workspaceId, workspaceId))

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

  logger.info(`[${options.requestId}] Archived workspace ${workspaceId}`)

  return {
    archived: true,
    workspaceName: workspaceRecord.name,
  }
}
