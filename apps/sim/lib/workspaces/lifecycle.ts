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
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { mcpService } from '@/lib/mcp/service'
import { archiveWorkflowsForWorkspace } from '@/lib/workflows/lifecycle'
import { createWorkspaceRecord } from '@/lib/workspaces/create'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

const logger = createLogger('WorkspaceLifecycle')

/** Matches the pre-existing "you have no workspaces" client-side recovery naming. */
const FALLBACK_WORKSPACE_NAME = 'My Workspace'

interface ArchiveWorkspaceOptions {
  requestId: string
  /**
   * Skips auto-provisioning replacement workspaces for members who'd otherwise be stranded.
   * Only for account-disable flows: a banned user's owned workspaces must be fully disabled, and
   * the banned user specifically should not be handed a fresh workspace as a side effect.
   */
  force?: boolean
}

interface ArchiveWorkspaceResult {
  archived: boolean
  workspaceName?: string
  /** userIds who were auto-provisioned a replacement workspace because this deletion would
   *  otherwise have left them with zero active workspaces. */
  provisionedWorkspaceUserIds?: string[]
}

/**
 * Returns the userIds of explicit workspace members for whom `workspaceId` is their only
 * accessible active (non-archived) workspace. "Accessible" includes workspaces granted through
 * an explicit permission row AND workspaces derived from organization owner/admin role — an org
 * admin can always fall back to the rest of the organization's workspaces even without an
 * explicit permission row on any of them, so they are never stranded by this deletion.
 *
 * Must be called against the same executor used to perform the archival, under
 * `serializable` isolation, so the check and the write are atomic with respect to a concurrent
 * deletion of another workspace shared by the same member.
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

  const strandedUserIds: string[] = []
  for (const { userId } of members) {
    const accessible = await listAccessibleWorkspaceRowsForUser(userId, 'active', executor)
    const hasOtherWorkspace = accessible.some((row) => row.workspace.id !== workspaceId)
    if (!hasOtherWorkspace) {
      strandedUserIds.push(userId)
    }
  }

  return strandedUserIds
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

  // serializable: without it, two concurrent deletions sharing a sole member could each read a
  // pre-deletion workspace count and both skip provisioning a replacement. Postgres detects this
  // write skew under serializable isolation and aborts one transaction. Skipped when force is
  // set, since that path never runs the stranded-member check at all.
  const transactionConfig = options.force
    ? undefined
    : ({ isolationLevel: 'serializable' } as const)

  let provisionedWorkspaceUserIds: string[] = []

  await db.transaction(async (tx) => {
    if (!options.force) {
      const strandedUserIds = await findMembersStrandedByArchival(tx, workspaceId)
      for (const userId of strandedUserIds) {
        await createWorkspaceRecord({
          userId,
          name: FALLBACK_WORKSPACE_NAME,
          organizationId: null,
          workspaceMode: WORKSPACE_MODE.PERSONAL,
          billedAccountUserId: userId,
          executor: tx,
        })
      }
      provisionedWorkspaceUserIds = strandedUserIds
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
  }, transactionConfig)

  await archiveWorkflowsForWorkspace(workspaceId, options)

  logger.info(`[${options.requestId}] Archived workspace ${workspaceId}`)
  if (provisionedWorkspaceUserIds.length > 0) {
    logger.info(
      `[${options.requestId}] Provisioned replacement workspaces for members stranded by archiving ${workspaceId}`,
      { userIds: provisionedWorkspaceUserIds }
    )
  }

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
    ...(provisionedWorkspaceUserIds.length > 0 && { provisionedWorkspaceUserIds }),
  }
}
