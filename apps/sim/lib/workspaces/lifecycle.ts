import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  apiKey,
  document,
  invitation,
  invitationWorkspaceGrant,
  knowledgeBase,
  knowledgeConnector,
  mcpServers,
  member,
  permissions,
  userTableDefinitions,
  workflowMcpServer,
  workflowSchedule,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import { PlatformEvents } from '@/lib/core/telemetry'
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
   * Opts into auto-provisioning a replacement workspace for any member who'd otherwise be left
   * with zero active workspaces. Off by default so archival stays a pure "delete this workspace"
   * primitive for callers that don't need it. Safe to combine with a banned owner: actively banned
   * users are excluded from receiving a fallback regardless of this flag (see
   * `findMembersStrandedByArchival`), so the account-disable flow also sets this to protect any
   * non-banned co-member of the banned owner's workspace.
   */
  provisionFallbackForStrandedMembers?: boolean
  actorId?: string
  actorName?: string | null
  actorEmail?: string | null
}

interface ArchiveWorkspaceResult {
  archived: boolean
  workspaceName?: string
  /** userIds who were auto-provisioned a replacement workspace because this deletion would
   *  otherwise have left them with zero active workspaces. */
  provisionedWorkspaceUserIds?: string[]
}

/**
 * Returns the userIds who would be left with zero accessible active (non-archived) workspaces if
 * `workspaceId` were archived. Candidates are the union of explicit workspace members AND the
 * organization's admins/owners — an org admin can access a workspace purely through their org
 * role with no permission row at all, so they must be checked even though they never show up as
 * an explicit member. "Accessible" (via `listAccessibleWorkspaceRowsForUser`) already accounts for
 * that same org-admin-derived access when deciding whether a candidate has another workspace to
 * fall back to. Actively banned users are excluded from the result — they should never receive a
 * new resource as a side effect of someone else's action.
 *
 * Must be called against the same executor used to perform the archival, under
 * `serializable` isolation, so the check and the write are atomic with respect to a concurrent
 * deletion of another workspace shared by the same member.
 */
async function findMembersStrandedByArchival(
  executor: DbOrTx,
  workspaceId: string,
  organizationId: string | null
): Promise<string[]> {
  const explicitMembers = await executor
    .selectDistinct({ userId: permissions.userId })
    .from(permissions)
    .where(and(eq(permissions.entityId, workspaceId), eq(permissions.entityType, 'workspace')))

  const candidateUserIds = new Set(explicitMembers.map((row) => row.userId))

  if (organizationId) {
    const orgAdmins = await executor
      .selectDistinct({ userId: member.userId })
      .from(member)
      .where(
        and(eq(member.organizationId, organizationId), inArray(member.role, [...ORG_ADMIN_ROLES]))
      )
    for (const { userId } of orgAdmins) {
      candidateUserIds.add(userId)
    }
  }

  if (candidateUserIds.size === 0) {
    return []
  }

  const strandedUserIds: string[] = []
  for (const userId of candidateUserIds) {
    const accessible = await listAccessibleWorkspaceRowsForUser(userId, 'active', executor)
    const hasOtherWorkspace = accessible.some((row) => row.workspace.id !== workspaceId)
    if (!hasOtherWorkspace) {
      strandedUserIds.push(userId)
    }
  }

  if (strandedUserIds.length === 0) {
    return []
  }

  const bannedUserIds = new Set(await getActivelyBannedUserIds(strandedUserIds, executor))
  return strandedUserIds.filter((userId) => !bannedUserIds.has(userId))
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
  // write skew under serializable isolation and aborts one transaction. Only needed when the
  // stranded-member check actually runs.
  const transactionConfig = options.provisionFallbackForStrandedMembers
    ? ({ isolationLevel: 'serializable' } as const)
    : undefined

  const provisionedFallbacks = await db.transaction(async (tx) => {
    const fallbacks: Array<{ userId: string; workspaceId: string; name: string }> = []

    if (options.provisionFallbackForStrandedMembers) {
      const strandedUserIds = await findMembersStrandedByArchival(
        tx,
        workspaceId,
        workspaceRecord.organizationId
      )
      for (const userId of strandedUserIds) {
        // Intentionally bypasses getWorkspaceCreationPolicy: this is a system-provisioned safety
        // net (never blocked by "who can create a workspace" rules), not user self-service.
        const fallbackWorkspace = await createWorkspaceRecord({
          userId,
          name: FALLBACK_WORKSPACE_NAME,
          organizationId: null,
          workspaceMode: WORKSPACE_MODE.PERSONAL,
          billedAccountUserId: userId,
          executor: tx,
        })
        fallbacks.push({ userId, workspaceId: fallbackWorkspace.id, name: fallbackWorkspace.name })
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

    return fallbacks
  }, transactionConfig)

  // Recorded/fired only after the transaction commits — recordAudit and the telemetry event are
  // fire-and-forget and don't participate in the transaction, so triggering them earlier could
  // leave a phantom audit entry / event pointing at a fallback workspace that got rolled back
  // (e.g. on a serialization failure). `createWorkspaceRecord` defers its own `workspaceCreated`
  // event for exactly this reason when given an `executor` — this is where it gets fired instead.
  for (const fallback of provisionedFallbacks) {
    try {
      PlatformEvents.workspaceCreated({
        workspaceId: fallback.workspaceId,
        userId: fallback.userId,
        name: fallback.name,
      })
    } catch {
      // Telemetry should not fail the operation
    }

    if (options.actorId) {
      recordAudit({
        workspaceId: fallback.workspaceId,
        actorId: options.actorId,
        actorName: options.actorName,
        actorEmail: options.actorEmail,
        action: AuditAction.WORKSPACE_CREATED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: fallback.workspaceId,
        resourceName: fallback.name,
        description: `Auto-created replacement workspace "${fallback.name}" for a member left with no workspace after deleting "${workspaceRecord.name}"`,
        metadata: { deletedWorkspaceId: workspaceId, recipientUserId: fallback.userId },
      })
    }
  }

  const provisionedWorkspaceUserIds = provisionedFallbacks.map((fallback) => fallback.userId)

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
