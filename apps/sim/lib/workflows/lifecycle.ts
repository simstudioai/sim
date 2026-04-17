import { db } from '@sim/db'
import {
  a2aAgent,
  apiKey,
  chat,
  form,
  webhook,
  workflow,
  workflowDeploymentVersion,
  workflowFolder,
  workflowMcpTool,
  workflowSchedule,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { getSocketServerUrl } from '@/lib/core/utils/urls'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { getWorkflowById } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowLifecycle')

interface ArchiveWorkflowOptions {
  requestId: string
  notifySocket?: boolean
  archivedAt?: Date
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
  requestId: string
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
        await cleanupExternalWebhook(webhookData.webhook, webhookData.workflow, requestId)
      } catch (error) {
        logger.warn(
          `[${requestId}] Failed to cleanup external webhook ${webhookData.webhook.id} for workflow ${workflowId}`,
          { error }
        )
      }
    }
  } catch (error) {
    logger.warn(`[${requestId}] Error during external webhook cleanup for workflow ${workflowId}`, {
      error,
    })
  }
}

async function clearA2AAgentCardCache(workflowId: string, requestId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    return
  }

  try {
    const agents = await db
      .select({ id: a2aAgent.id })
      .from(a2aAgent)
      .where(and(eq(a2aAgent.workflowId, workflowId), isNull(a2aAgent.archivedAt)))

    if (agents.length === 0) {
      return
    }

    await redis.del(...agents.map((agent) => `a2a:agent:${agent.id}:card`))
  } catch (error) {
    logger.warn(`[${requestId}] Failed to clear A2A agent card cache for workflow ${workflowId}`, {
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

  await clearA2AAgentCardCache(workflowId, options.requestId)

  await db.transaction(async (tx) => {
    await tx
      .update(workflowSchedule)
      .set({
        archivedAt: now,
        updatedAt: now,
        status: 'disabled',
        nextRunAt: null,
        lastQueuedAt: null,
      })
      .where(and(eq(workflowSchedule.workflowId, workflowId), isNull(workflowSchedule.archivedAt)))

    await tx
      .update(webhook)
      .set({
        archivedAt: now,
        updatedAt: now,
        isActive: false,
      })
      .where(and(eq(webhook.workflowId, workflowId), isNull(webhook.archivedAt)))

    await tx
      .update(chat)
      .set({
        archivedAt: now,
        updatedAt: now,
        isActive: false,
      })
      .where(and(eq(chat.workflowId, workflowId), isNull(chat.archivedAt)))

    await tx
      .update(form)
      .set({
        archivedAt: now,
        updatedAt: now,
        isActive: false,
      })
      .where(and(eq(form.workflowId, workflowId), isNull(form.archivedAt)))

    await tx
      .update(workflowMcpTool)
      .set({
        archivedAt: now,
        updatedAt: now,
      })
      .where(and(eq(workflowMcpTool.workflowId, workflowId), isNull(workflowMcpTool.archivedAt)))

    await tx
      .update(workflowDeploymentVersion)
      .set({
        isActive: false,
      })
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))

    await tx
      .update(a2aAgent)
      .set({
        archivedAt: now,
        updatedAt: now,
        isPublished: false,
      })
      .where(and(eq(a2aAgent.workflowId, workflowId), isNull(a2aAgent.archivedAt)))

    await tx
      .update(workflow)
      .set({
        archivedAt: now,
        updatedAt: now,
        isDeployed: false,
        isPublicApi: false,
      })
      .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
  })

  try {
    PlatformEvents.workflowDeleted({
      workflowId,
      workspaceId: existingWorkflow.workspaceId || undefined,
    })
  } catch {}

  if (options.notifySocket !== false) {
    await notifyWorkflowArchived(workflowId, options.requestId)
  }

  await cleanupExternalWebhooksForWorkflow(workflowId, options.requestId)

  if (existingWorkflow.workspaceId && mcpPubSub && affectedWorkflowMcpServers.length > 0) {
    const uniqueServerIds = [...new Set(affectedWorkflowMcpServers.map((row) => row.serverId))]
    for (const serverId of uniqueServerIds) {
      mcpPubSub.publishWorkflowToolsChanged({
        serverId,
        workspaceId: existingWorkflow.workspaceId,
      })
    }
  }

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
      .select({ archivedAt: workflowFolder.archivedAt })
      .from(workflowFolder)
      .where(eq(workflowFolder.id, existingWorkflow.folderId))

    if (!folder || folder.archivedAt) {
      clearFolderId = true
    }
  }

  const now = new Date()

  await db.transaction(async (tx) => {
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
      .where(eq(workflowSchedule.workflowId, workflowId))

    await tx
      .update(webhook)
      .set({ archivedAt: null, updatedAt: now })
      .where(eq(webhook.workflowId, workflowId))

    await tx
      .update(chat)
      .set({ archivedAt: null, updatedAt: now })
      .where(eq(chat.workflowId, workflowId))

    await tx
      .update(form)
      .set({ archivedAt: null, updatedAt: now })
      .where(eq(form.workflowId, workflowId))

    await tx
      .update(workflowMcpTool)
      .set({ archivedAt: null, updatedAt: now })
      .where(eq(workflowMcpTool.workflowId, workflowId))

    await tx
      .update(a2aAgent)
      .set({ archivedAt: null, updatedAt: now })
      .where(eq(a2aAgent.workflowId, workflowId))
  })

  logger.info(`[${options.requestId}] Restored workflow ${workflowId}`)

  return {
    restored: true,
    workflow: await getWorkflowById(workflowId),
  }
}

export async function archiveWorkflows(
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
 * they own (cascading to workflows, chats, forms, KBs, tables, files, etc.)
 * and deleting their personal API keys.
 */
export async function disableUserResources(userId: string): Promise<void> {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Disabling resources for banned user ${userId}`)

  const { archiveWorkspace } = await import('@/lib/workspaces/lifecycle')

  const ownedWorkspaces = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.ownerId, userId), isNull(workspace.archivedAt)))

  await Promise.all([
    ...ownedWorkspaces.map((w) => archiveWorkspace(w.id, { requestId })),
    db.delete(apiKey).where(eq(apiKey.userId, userId)),
  ])

  logger.info(
    `[${requestId}] Disabled resources for user ${userId}: archived ${ownedWorkspaces.length} workspaces, deleted API keys`
  )
}
