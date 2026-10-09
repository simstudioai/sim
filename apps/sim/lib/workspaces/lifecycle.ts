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
  workflow,
  workflowMcpServer,
  workflowMcpTool,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbTransaction } from '@/lib/db/types'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { mcpService } from '@/lib/mcp/service'
import { archiveProjectWithLastEnvironment, lockWorkspaceProject } from '@/lib/projects/membership'
import { archiveWorkflowsInTransaction, finishWorkflowArchive } from '@/lib/workflows/lifecycle'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceLifecycle')

/** Bounds each batched workflow archive statement's parameter list. */
const WORKFLOW_ARCHIVE_BATCH_SIZE = 1_000
/** Bounds concurrent post-commit notifications; each is best-effort and catches its own errors. */
const ARCHIVE_NOTIFICATION_CONCURRENCY = 8

/** What an environment archive must announce once its transaction commits. */
export interface EnvironmentArchiveEffects {
  workspaceId: string
  workflows: { id: string; serverIds: string[] }[]
  serverIds: string[]
}

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

  const outcome = await db.transaction(async (tx) => {
    const owningProject = await lockWorkspaceProject(tx, workspaceId)
    /** Waits out in-flight workflow creation and restore, so their rows are archived too. */
    const [current] = await tx
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .for('no key update')
    if (!current) return null
    if (options.expectedOwnerId && current.ownerId !== options.expectedOwnerId) return null
    const projectArchived =
      owningProject !== null &&
      (await archiveProjectWithLastEnvironment(tx, owningProject.id, workspaceId, now))
    return {
      effects: await archiveEnvironmentInTransaction(tx, workspaceId, now),
      archivedProject: projectArchived
        ? { id: owningProject.id, name: owningProject.name }
        : undefined,
    }
  })
  if (!outcome) return { archived: false }

  logger.info(`[${options.requestId}] Archived workspace ${workspaceId}`)

  await finishEnvironmentArchive(outcome.effects, options.requestId)

  return {
    archived: !workspaceRecord.archivedAt,
    workspaceName: workspaceRecord.name,
    archivedProject: outcome.archivedProject,
  }
}

/**
 * Archives an environment and its active workflows in the caller's transaction, batching
 * the workflow statements; callers own the Project lifecycle. Announce the returned
 * effects with {@link finishEnvironmentArchive} after commit.
 */
export async function archiveEnvironmentInTransaction(
  tx: DbTransaction,
  workspaceId: string,
  now: Date
): Promise<EnvironmentArchiveEffects> {
  const workflows: EnvironmentArchiveEffects['workflows'] = []
  const active = await tx
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
    .orderBy(asc(workflow.id))
  for (const batch of chunkArray(
    active.map((row) => row.id),
    WORKFLOW_ARCHIVE_BATCH_SIZE
  )) {
    const tools = await tx
      .select({ workflowId: workflowMcpTool.workflowId, serverId: workflowMcpTool.serverId })
      .from(workflowMcpTool)
      .where(and(inArray(workflowMcpTool.workflowId, batch), isNull(workflowMcpTool.archivedAt)))
    const serverIdsByWorkflow = new Map<string, string[]>()
    for (const tool of tools) {
      const serverIds = serverIdsByWorkflow.get(tool.workflowId)
      if (serverIds) serverIds.push(tool.serverId)
      else serverIdsByWorkflow.set(tool.workflowId, [tool.serverId])
    }
    await archiveWorkflowsInTransaction(tx, batch, now)
    for (const id of batch) workflows.push({ id, serverIds: serverIdsByWorkflow.get(id) ?? [] })
  }
  const serverIds = await archiveWorkspaceRecordsInTransaction(tx, workspaceId, now)
  return { workspaceId, workflows, serverIds }
}

/**
 * Announces a committed environment archive. Cleanup is best-effort by default; maintenance
 * callers can require provider cleanup to succeed before recording completion.
 */
export async function finishEnvironmentArchive(
  effects: EnvironmentArchiveEffects,
  requestId: string,
  options: { strictExternalCleanup?: boolean } = {}
): Promise<void> {
  const { workspaceId } = effects
  await mapWithConcurrency(effects.workflows, ARCHIVE_NOTIFICATION_CONCURRENCY, (row) =>
    finishWorkflowArchive(row.id, workspaceId, row.serverIds, {
      requestId,
      strictExternalCleanup: options.strictExternalCleanup,
    }).catch((error) =>
      options.strictExternalCleanup
        ? Promise.reject(error)
        : logger.warn(`[${requestId}] Post-archive notification failed for workflow ${row.id}`, {
            error,
          })
    )
  )
  await mcpService.clearCache(workspaceId).catch(() => undefined)
  if (!mcpPubSub) return
  for (const serverId of effects.serverIds) {
    try {
      mcpPubSub.publishWorkflowToolsChanged({ serverId, workspaceId })
    } catch (error) {
      logger.warn(`[${requestId}] MCP tools-changed publish failed for server ${serverId}`, {
        error,
      })
    }
  }
}

/** The workspace row and its non-workflow resources; returns the deployed MCP server ids. */
async function archiveWorkspaceRecordsInTransaction(
  tx: DbTransaction,
  workspaceId: string,
  now: Date
): Promise<string[]> {
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

  /** Every server is announced, so a retry still invalidates; only live ones are stamped. */
  const servers = await tx
    .select({ id: workflowMcpServer.id })
    .from(workflowMcpServer)
    .where(eq(workflowMcpServer.workspaceId, workspaceId))
  await tx
    .update(workflowMcpServer)
    .set({
      deletedAt: now,
      isPublic: false,
      updatedAt: now,
    })
    .where(and(eq(workflowMcpServer.workspaceId, workspaceId), isNull(workflowMcpServer.deletedAt)))

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
  return servers.map((server) => server.id)
}
