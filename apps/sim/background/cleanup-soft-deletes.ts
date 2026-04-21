import { db } from '@sim/db'
import {
  a2aAgent,
  copilotChats,
  knowledgeBase,
  mcpServers,
  memory,
  userTableDefinitions,
  workflow,
  workflowFolder,
  workflowMcpServer,
  workspaceFile,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { and, inArray, isNotNull, lt } from 'drizzle-orm'
import { type CleanupJobPayload, resolveCleanupScope } from '@/lib/billing/cleanup-dispatcher'
import {
  batchDeleteByWorkspaceAndTimestamp,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_BATCHES_PER_TABLE,
  deleteRowsById,
} from '@/lib/cleanup/batch-delete'
import { prepareChatCleanup } from '@/lib/cleanup/chat-cleanup'
import type { StorageContext } from '@/lib/uploads'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'

const logger = createLogger('CleanupSoftDeletes')

interface WorkspaceFileScope {
  /** Rows from `workspace_file` (singular, legacy workspace-context only). */
  legacyRows: Array<{ id: string; key: string }>
  /** Rows from `workspace_files` (plural, multi-context). */
  multiContextRows: Array<{ id: string; key: string; context: StorageContext }>
}

/**
 * Select every soft-deleted file row that's eligible for permanent removal.
 * Returned once and reused for both S3 deletion and DB deletion so the external
 * cleanup cannot drift from the row-level cleanup.
 */
async function selectExpiredWorkspaceFiles(
  workspaceIds: string[],
  retentionDate: Date
): Promise<WorkspaceFileScope> {
  const limit = DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE

  const [legacyRows, multiContextRows] = await Promise.all([
    db
      .select({ id: workspaceFile.id, key: workspaceFile.key })
      .from(workspaceFile)
      .where(
        and(
          inArray(workspaceFile.workspaceId, workspaceIds),
          isNotNull(workspaceFile.deletedAt),
          lt(workspaceFile.deletedAt, retentionDate)
        )
      )
      .limit(limit),
    db
      .select({
        id: workspaceFiles.id,
        key: workspaceFiles.key,
        context: workspaceFiles.context,
      })
      .from(workspaceFiles)
      .where(
        and(
          inArray(workspaceFiles.workspaceId, workspaceIds),
          isNotNull(workspaceFiles.deletedAt),
          lt(workspaceFiles.deletedAt, retentionDate)
        )
      )
      .limit(limit),
  ])

  return {
    legacyRows,
    multiContextRows: multiContextRows.map((r) => ({
      id: r.id,
      key: r.key,
      context: r.context as StorageContext,
    })),
  }
}

async function cleanupWorkspaceFileStorage(
  scope: WorkspaceFileScope
): Promise<{ filesDeleted: number; filesFailed: number }> {
  const stats = { filesDeleted: 0, filesFailed: 0 }
  if (!isUsingCloudStorage()) return stats

  const toDelete: Array<{ key: string; context: StorageContext }> = [
    ...scope.legacyRows.map((r) => ({ key: r.key, context: 'workspace' as StorageContext })),
    ...scope.multiContextRows.map((r) => ({ key: r.key, context: r.context })),
  ]

  await Promise.all(
    toDelete.map(async ({ key, context }) => {
      try {
        await StorageService.deleteFile({ key, context })
        stats.filesDeleted++
      } catch (error) {
        stats.filesFailed++
        logger.error(`Failed to delete storage file ${key} (context: ${context}):`, { error })
      }
    })
  )

  return stats
}

/**
 * Tables cleaned by the generic workspace-scoped batched DELETE. Tables whose
 * hard-delete triggers external side effects (workflow → copilot chats cascade,
 * workspace files → S3 storage) are handled explicitly so the SELECT that drives
 * the external cleanup and the SELECT that drives the DB delete see the same rows.
 */
const CLEANUP_TARGETS = [
  {
    table: workflowFolder,
    softDeleteCol: workflowFolder.archivedAt,
    wsCol: workflowFolder.workspaceId,
    name: 'workflowFolder',
  },
  {
    table: knowledgeBase,
    softDeleteCol: knowledgeBase.deletedAt,
    wsCol: knowledgeBase.workspaceId,
    name: 'knowledgeBase',
  },
  {
    table: userTableDefinitions,
    softDeleteCol: userTableDefinitions.archivedAt,
    wsCol: userTableDefinitions.workspaceId,
    name: 'userTableDefinitions',
  },
  { table: memory, softDeleteCol: memory.deletedAt, wsCol: memory.workspaceId, name: 'memory' },
  {
    table: mcpServers,
    softDeleteCol: mcpServers.deletedAt,
    wsCol: mcpServers.workspaceId,
    name: 'mcpServers',
  },
  {
    table: workflowMcpServer,
    softDeleteCol: workflowMcpServer.deletedAt,
    wsCol: workflowMcpServer.workspaceId,
    name: 'workflowMcpServer',
  },
  {
    table: a2aAgent,
    softDeleteCol: a2aAgent.archivedAt,
    wsCol: a2aAgent.workspaceId,
    name: 'a2aAgent',
  },
] as const

export async function runCleanupSoftDeletes(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()

  const scope = await resolveCleanupScope('cleanup-soft-deletes', payload)
  if (!scope) {
    logger.info(`[${payload.plan}] No retention configured, skipping`)
    return
  }

  const { workspaceIds, retentionHours, label } = scope

  if (workspaceIds.length === 0) {
    logger.info(`[${label}] No workspaces to process`)
    return
  }

  const retentionDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  logger.info(
    `[${label}] Processing ${workspaceIds.length} workspaces, cutoff: ${retentionDate.toISOString()}`
  )

  // Select workflows + files once. These sets drive BOTH external cleanup
  // (chats + S3) AND the DB deletes below — selecting twice could return
  // different subsets above the LIMIT cap and orphan or prematurely purge data.
  const [doomedWorkflows, fileScope] = await Promise.all([
    db
      .select({ id: workflow.id })
      .from(workflow)
      .where(
        and(
          inArray(workflow.workspaceId, workspaceIds),
          isNotNull(workflow.archivedAt),
          lt(workflow.archivedAt, retentionDate)
        )
      )
      .limit(DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE),
    selectExpiredWorkspaceFiles(workspaceIds, retentionDate),
  ])

  const doomedWorkflowIds = doomedWorkflows.map((w) => w.id)
  let chatCleanup: { execute: () => Promise<void> } | null = null

  if (doomedWorkflowIds.length > 0) {
    const doomedChats = await db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(inArray(copilotChats.workflowId, doomedWorkflowIds))
      .limit(DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE)

    const doomedChatIds = doomedChats.map((c) => c.id)
    if (doomedChatIds.length > 0) {
      chatCleanup = await prepareChatCleanup(doomedChatIds, label)
    }
  }

  const fileStats = await cleanupWorkspaceFileStorage(fileScope)

  let totalDeleted = 0

  // Delete the workflow + file rows using the exact IDs we already selected.
  const workflowResult = await deleteRowsById(
    workflow,
    workflow.id,
    doomedWorkflowIds,
    `${label}/workflow`
  )
  totalDeleted += workflowResult.deleted

  const legacyFileResult = await deleteRowsById(
    workspaceFile,
    workspaceFile.id,
    fileScope.legacyRows.map((r) => r.id),
    `${label}/workspaceFile`
  )
  totalDeleted += legacyFileResult.deleted

  const multiContextFileResult = await deleteRowsById(
    workspaceFiles,
    workspaceFiles.id,
    fileScope.multiContextRows.map((r) => r.id),
    `${label}/workspaceFiles`
  )
  totalDeleted += multiContextFileResult.deleted

  for (const target of CLEANUP_TARGETS) {
    const result = await batchDeleteByWorkspaceAndTimestamp({
      tableDef: target.table,
      workspaceIdCol: target.wsCol,
      timestampCol: target.softDeleteCol,
      workspaceIds,
      retentionDate,
      tableName: `${label}/${target.name}`,
      requireTimestampNotNull: true,
    })
    totalDeleted += result.deleted
  }

  logger.info(
    `[${label}] Complete: ${totalDeleted} rows deleted, ${fileStats.filesDeleted} files cleaned`
  )

  // Clean up copilot backend + chat storage files after DB rows are gone
  if (chatCleanup) {
    await chatCleanup.execute()
  }

  const timeElapsed = (Date.now() - startTime) / 1000
  logger.info(`[${label}] Job completed in ${timeElapsed.toFixed(2)}s`)
}

export const cleanupSoftDeletesTask = task({
  id: 'cleanup-soft-deletes',
  run: runCleanupSoftDeletes,
})
