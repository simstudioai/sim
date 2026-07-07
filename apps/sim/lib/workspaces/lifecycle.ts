import { db } from '@sim/db'
import {
  apiKey,
  document,
  invitation,
  invitationWorkspaceGrant,
  knowledgeBase,
  knowledgeConnector,
  mcpServers,
  permissions,
  userTableDefinitions,
  workflowMcpServer,
  workflowSchedule,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { DbOrTx } from '@sim/workflow-persistence/types'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { mcpService } from '@/lib/mcp/service'
import { archiveWorkflowsForWorkspace } from '@/lib/workflows/lifecycle'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceLifecycle')

interface ArchiveWorkspaceOptions {
  requestId: string
  /**
   * Skips the "would strand a member" safety check. Only for account-disable flows where every
   * workspace owned by the disabled user must be archived regardless of member workspace counts.
   */
  force?: boolean
}

interface ArchiveWorkspaceResult {
  archived: boolean
  workspaceName?: string
  /** Present only when archival was blocked because it would leave these members with zero workspaces. */
  strandedUserIds?: string[]
}

class WorkspaceArchiveBlockedError extends Error {
  constructor(readonly strandedUserIds: string[]) {
    super('Archiving this workspace would leave one or more members with no workspace')
    this.name = 'WorkspaceArchiveBlockedError'
  }
}

/**
 * Returns the userIds of workspace members for whom `workspaceId` is their only active
 * (non-archived) workspace. Must be called against the same executor used to perform the
 * archival so the check and the write are atomic.
 */
async function findMembersStrandedByArchival(
  executor: DbOrTx,
  workspaceId: string
): Promise<string[]> {
  const members = await executor
    .selectDistinct({ userId: permissions.userId })
    .from(permissions)
    .where(and(eq(permissions.entityId, workspaceId), eq(permissions.entityType, 'workspace')))

  if (members.length === 0) {
    return []
  }

  const memberIds = members.map((member) => member.userId)

  const workspaceCounts = await executor
    .select({
      userId: permissions.userId,
      workspaceCount: sql<number>`count(distinct ${workspace.id})`,
    })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      and(
        inArray(permissions.userId, memberIds),
        eq(permissions.entityType, 'workspace'),
        isNull(workspace.archivedAt)
      )
    )
    .groupBy(permissions.userId)

  return workspaceCounts.filter((row) => Number(row.workspaceCount) <= 1).map((row) => row.userId)
}

export async function archiveWorkspace(
  workspaceId: string,
  options: ArchiveWorkspaceOptions
): Promise<ArchiveWorkspaceResult> {
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

  try {
    await db.transaction(async (tx) => {
      if (!options.force) {
        const strandedUserIds = await findMembersStrandedByArchival(tx, workspaceId)
        if (strandedUserIds.length > 0) {
          throw new WorkspaceArchiveBlockedError(strandedUserIds)
        }
      }

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
  } catch (error) {
    if (error instanceof WorkspaceArchiveBlockedError) {
      return {
        archived: false,
        workspaceName: workspaceRecord.name,
        strandedUserIds: error.strandedUserIds,
      }
    }
    throw error
  }

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
