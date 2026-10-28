import { db } from '@sim/db'
import {
  apiKey,
  chat,
  folder as folderTable,
  webhook,
  workflow,
  workflowDeploymentVersion,
  workflowMcpTool,
  workflowSchedule,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { getSocketServerUrl } from '@/lib/core/utils/urls'
import type { DbTransaction } from '@/lib/db/types'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { releaseWebhookPathClaims } from '@/lib/webhooks/path-claims'
import { supersedeInFlightDeploymentOperations } from '@/lib/workflows/persistence/deployment-operations'
import { getWorkflowById } from '@/lib/workflows/utils'
import { lockActiveWorkspace } from '@/lib/workspaces/active-workspace'

const logger = createLogger('WorkflowLifecycle')

interface ArchiveWorkflowOptions {
  requestId: string
  notifySocket?: boolean
  archivedAt?: Date
  strictExternalCleanup?: boolean
}

async function notifyWorkflowArchived(workflowId: string, requestId: string): Promise<void> {
  try {
    const socketResponse = await fetch(`${getSocketServerUrl()}/api/workflow-deleted`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ workflowId }),
    })

    if (!socketResponse.ok) {
      logger.warn(`[${requestId}] Failed to notify Socket.IO about archived workflow ${workflowId}`)
    }
  } catch (error) {
    logger.warn(`[${requestId}] Error notifying Socket.IO about archived workflow ${workflowId}`, {
      error,
    })
  }
}

async function cleanupExternalWebhooksForWorkflow(
  workflowId: string,
  requestId: string,
  strict = false
): Promise<void> {
  try {
    const { cleanupExternalWebhook } = await import('@/lib/webhooks/provider-subscriptions')
    const webhooksToCleanup = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.workflowId, workflowId))

    for (const webhookData of webhooksToCleanup) {
      try {
        await cleanupExternalWebhook(webhookData.webhook, webhookData.workflow, requestId, {
          throwOnError: strict,
        })
      } catch (error) {
        if (strict) throw error
        logger.warn(
          `[${requestId}] Failed to cleanup external webhook ${webhookData.webhook.id} for workflow ${workflowId}`,
          { error }
        )
      }
    }
  } catch (error) {
    if (strict) throw error
    logger.warn(`[${requestId}] Error during external webhook cleanup for workflow ${workflowId}`, {
      error,
    })
  }
}

export async function archiveWorkflow(
  workflowId: string,
  options: ArchiveWorkflowOptions
): Promise<{ archived: boolean; workflow: Awaited<ReturnType<typeof getWorkflowById>> | null }> {
  const existingWorkflow = await getWorkflowById(workflowId, { includeArchived: true })

  if (!existingWorkflow) {
    return { archived: false, workflow: null }
  }

  if (existingWorkflow.archivedAt) {
    return { archived: false, workflow: existingWorkflow }
  }

  const now = options.archivedAt ?? new Date()
  const affectedWorkflowMcpServers = await db
    .select({ serverId: workflowMcpTool.serverId })
    .from(workflowMcpTool)
    .where(and(eq(workflowMcpTool.workflowId, workflowId), isNull(workflowMcpTool.archivedAt)))

  await db.transaction((tx) => archiveWorkflowsInTransaction(tx, [workflowId], now))

  await finishWorkflowArchive(
    workflowId,
    existingWorkflow.workspaceId,
    affectedWorkflowMcpServers.map((row) => row.serverId),
    options
  )

  return {
    archived: true,
    workflow: await getWorkflowById(workflowId, { includeArchived: true }),
  }
}

interface RestoreWorkflowOptions {
  requestId: string
}

export async function restoreWorkflow(
  workflowId: string,
  options: RestoreWorkflowOptions
): Promise<{ restored: boolean; workflow: Awaited<ReturnType<typeof getWorkflowById>> | null }> {
  const existingWorkflow = await getWorkflowById(workflowId, { includeArchived: true })

  if (!existingWorkflow) {
    return { restored: false, workflow: null }
  }

  if (!existingWorkflow.archivedAt) {
    return { restored: false, workflow: existingWorkflow }
  }

  if (existingWorkflow.workspaceId) {
    const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
    const ws = await getWorkspaceWithOwner(existingWorkflow.workspaceId)
    if (!ws || ws.archivedAt) {
      throw new Error('Cannot restore workflow into an archived workspace')
    }
  }

  let clearFolderId = false
  if (existingWorkflow.folderId) {
    const [folder] = await db
      .select({ archivedAt: folderTable.deletedAt })
      .from(folderTable)
      .where(
        and(eq(folderTable.id, existingWorkflow.folderId), eq(folderTable.resourceType, 'workflow'))
      )

    if (!folder || folder.archivedAt) {
      clearFolderId = true
    }
  }

  const now = new Date()

  /**
   * `archiveWorkflow` stamps the workflow and its dependents with ONE timestamp, and only
   * touches dependents that were still active. So the workflow's own `archivedAt` identifies
   * exactly the rows this archive took down.
   *
   * Restoring by `workflowId` alone instead resurrects a webhook or chat the user had archived
   * independently, days earlier — it was never part of this archive and the user never asked
   * for it back. Matching the stamp is the same rule the folder cascade uses, and it is what
   * the restore semantics documented for this feature actually promise.
   */
  const archivedAt = existingWorkflow.archivedAt

  await db.transaction(async (tx) => {
    if (existingWorkflow.workspaceId) await lockActiveWorkspace(tx, existingWorkflow.workspaceId)

    await tx
      .update(workflow)
      .set({
        archivedAt: null,
        updatedAt: now,
        ...(clearFolderId && { folderId: null }),
      })
      .where(eq(workflow.id, workflowId))

    await tx
      .update(workflowSchedule)
      .set({ archivedAt: null, updatedAt: now })
      .where(
        and(
          eq(workflowSchedule.workflowId, workflowId),
          eq(workflowSchedule.archivedAt, archivedAt)
        )
      )

    await tx
      .update(webhook)
      .set({ archivedAt: null, updatedAt: now })
      .where(and(eq(webhook.workflowId, workflowId), eq(webhook.archivedAt, archivedAt)))

    await tx
      .update(chat)
      .set({ archivedAt: null, updatedAt: now })
      .where(and(eq(chat.workflowId, workflowId), eq(chat.archivedAt, archivedAt)))

    await tx
      .update(workflowMcpTool)
      .set({ archivedAt: null, updatedAt: now })
      .where(
        and(eq(workflowMcpTool.workflowId, workflowId), eq(workflowMcpTool.archivedAt, archivedAt))
      )
  })

  logger.info(`[${options.requestId}] Restored workflow ${workflowId}`)

  return {
    restored: true,
    workflow: await getWorkflowById(workflowId),
  }
}

async function archiveWorkflows(
  workflowIds: string[],
  options: ArchiveWorkflowOptions
): Promise<number> {
  const uniqueWorkflowIds = Array.from(new Set(workflowIds))
  let archivedCount = 0

  for (const workflowId of uniqueWorkflowIds) {
    const result = await archiveWorkflow(workflowId, options)
    if (result.archived) {
      archivedCount += 1
    }
  }

  return archivedCount
}

export async function archiveWorkflowsForWorkspace(
  workspaceId: string,
  options: ArchiveWorkflowOptions
): Promise<number> {
  const workflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))

  return archiveWorkflows(
    workflows.map((entry) => entry.id),
    options
  )
}

export async function archiveWorkflowsByIdsInWorkspace(
  workspaceId: string,
  workflowIds: string[],
  options: ArchiveWorkflowOptions
): Promise<number> {
  if (workflowIds.length === 0) {
    return 0
  }

  const workflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        isNull(workflow.archivedAt),
        inArray(workflow.id, workflowIds)
      )
    )

  return archiveWorkflows(
    workflows.map((entry) => entry.id),
    options
  )
}

/**
 * Disables all resources owned by a banned user by archiving every workspace
 * they own (cascading to workflows, chats, KBs, tables, files, etc.),
 * deleting their personal API keys, and stopping the workflow runs in progress
 * in every workspace they own once it is archived, including ones archived
 * earlier. Each archive records Stop for its Chat runs, which they read on their
 * next run-control call.
 *
 * Runs the user started in workspaces they do not own keep going. The log row
 * has no actor column, and the user it records is the billed account for
 * schedule and webhook runs, so it cannot tell whose run it is; revoking the
 * keys and sessions stops the user starting more.
 */
export async function disableUserResources(userId: string): Promise<void> {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Disabling resources for banned user ${userId}`)

  const { archiveWorkspace } = await import('@/lib/workspaces/lifecycle')

  /** Revoked first: the keys are the ban's access boundary, and an archive may fail. */
  await db.delete(apiKey).where(eq(apiKey.userId, userId))

  const owned = await db
    .select({ id: workspace.id, archivedAt: workspace.archivedAt })
    .from(workspace)
    .where(eq(workspace.ownerId, userId))
  const ownedWorkspaces = owned.filter((row) => !row.archivedAt)

  const { recordExecutionStops, signalExecutionStops } = await import(
    '@/lib/execution/removal-stop-records'
  )
  /**
   * Records the workspaces' stops and signals their in-flight runs; the recorded stop's queue
   * sweep and retries run in the outbox worker, since this module sits in page graphs that must
   * not load that delivery. Logged, not thrown: the ban and archives have committed, and banning
   * the user again records the stops again, since every owned workspace is stopped, archived or
   * not.
   */
  let stopFailed = false
  const stopRuns = async (workspaceIds: string[]): Promise<void> => {
    if (workspaceIds.length === 0) return
    try {
      const executions = await db.transaction((tx) =>
        recordExecutionStops(tx, { workspaceIds, ownerId: userId })
      )
      await signalExecutionStops(executions)
    } catch (error) {
      stopFailed = true
      logger.error(`[${requestId}] Failed to stop runs for banned user ${userId}`, {
        workspaceIds,
        error: getErrorMessage(error),
      })
    }
  }

  const failures: { workspaceId: string; error: unknown }[] = []
  /** Workspaces archived before this ban still have the runs an archive leaves going. */
  const stopping = [stopRuns(owned.filter((row) => row.archivedAt).map((row) => row.id))]
  // Sequential: environments of one Project contend on its exclusive lock.
  for (const row of ownedWorkspaces) {
    try {
      await archiveWorkspace(row.id, {
        requestId,
        expectedOwnerId: userId,
        /** Called once the archive commits, before its slower post-commit cleanup. */
        deliverStops: () => {
          stopping.push(stopRuns([row.id]))
        },
      })
    } catch (error) {
      failures.push({ workspaceId: row.id, error })
    }
  }

  await Promise.all(stopping)

  if (failures.length > 0) {
    logger.error(`[${requestId}] Failed to archive workspaces for banned user ${userId}`, {
      failures: failures.map(({ workspaceId, error }) => ({
        workspaceId,
        error: getErrorMessage(error),
      })),
    })
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Failed to archive ${failures.length} of ${ownedWorkspaces.length} workspaces for banned user ${userId}`
    )
  }

  logger.info(
    `[${requestId}] Disabled resources for user ${userId}: archived ${ownedWorkspaces.length} workspaces, deleted API keys, ${stopFailed ? 'failed to stop some of their runs' : 'stopped their runs'}`
  )
}

/**
 * Durable archive state shared by single-workflow and compound Project archival. Each
 * statement covers the whole batch, so the round trips do not grow with its size.
 */
export async function archiveWorkflowsInTransaction(
  tx: DbTransaction,
  workflowIds: readonly string[],
  now: Date
): Promise<void> {
  if (workflowIds.length === 0) return
  await supersedeInFlightDeploymentOperations(tx, workflowIds)
  await releaseWebhookPathClaims(tx, workflowIds)

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
      and(inArray(workflowSchedule.workflowId, workflowIds), isNull(workflowSchedule.archivedAt))
    )

  await tx
    .update(webhook)
    .set({
      archivedAt: now,
      updatedAt: now,
      isActive: false,
    })
    .where(and(inArray(webhook.workflowId, workflowIds), isNull(webhook.archivedAt)))

  await tx
    .update(chat)
    .set({
      archivedAt: now,
      updatedAt: now,
      isActive: false,
    })
    .where(and(inArray(chat.workflowId, workflowIds), isNull(chat.archivedAt)))

  await tx
    .update(workflowMcpTool)
    .set({
      archivedAt: now,
      updatedAt: now,
    })
    .where(
      and(inArray(workflowMcpTool.workflowId, workflowIds), isNull(workflowMcpTool.archivedAt))
    )

  await tx
    .update(workflowDeploymentVersion)
    .set({
      isActive: false,
    })
    .where(
      and(
        inArray(workflowDeploymentVersion.workflowId, workflowIds),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )

  await tx
    .update(workflow)
    .set({
      archivedAt: now,
      updatedAt: now,
      isDeployed: false,
      isPublicApi: false,
    })
    .where(and(inArray(workflow.id, workflowIds), isNull(workflow.archivedAt)))
}

/** Best-effort external notifications run only after durable archive state commits. */
export async function finishWorkflowArchive(
  workflowId: string,
  workspaceId: string | null,
  serverIds: string[],
  options: ArchiveWorkflowOptions
): Promise<void> {
  try {
    PlatformEvents.workflowDeleted({
      workflowId,
      workspaceId: workspaceId || undefined,
    })
  } catch {}

  if (options.notifySocket !== false) {
    await notifyWorkflowArchived(workflowId, options.requestId)
  }

  await cleanupExternalWebhooksForWorkflow(
    workflowId,
    options.requestId,
    options.strictExternalCleanup
  )

  if (workspaceId && mcpPubSub) {
    for (const serverId of new Set(serverIds)) {
      try {
        mcpPubSub.publishWorkflowToolsChanged({ serverId, workspaceId })
      } catch (error) {
        logger.warn(
          `[${options.requestId}] MCP tools-changed publish failed for server ${serverId}`,
          { error }
        )
      }
    }
  }
}
