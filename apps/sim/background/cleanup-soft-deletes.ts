import { db } from '@sim/db'
import {
  copilotChats,
  document,
  embedding,
  knowledgeBase,
  mcpServers,
  memory,
  userTableDefinitions,
  userTableRows,
  workflow,
  workflowFolder,
  workflowMcpServer,
  workspaceFile,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import {
  batchDeleteByWorkspaceAndTimestamp,
  chunkArray,
  DEFAULT_BATCH_SIZE,
  DEFAULT_WORKSPACE_CHUNK_SIZE,
  deleteRowsById,
  selectRowsByIdChunks,
} from '@/lib/cleanup/batch-delete'
import { prepareChatCleanup } from '@/lib/cleanup/chat-cleanup'
import type { StorageContext } from '@/lib/uploads'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'

const logger = createLogger('CleanupSoftDeletes')

const KB_ORPHAN_BINDING_BATCH_SIZE = 500
const KB_ORPHAN_BINDING_TOTAL_LIMIT = 5_000
/**
 * Grace window before an unreferenced KB binding is swept. Comfortably longer
 * than any presign → upload → document-insert flow, so an in-flight upload is
 * never mistaken for an abandoned one.
 */
const KB_ORPHAN_BINDING_GRACE_HOURS = 7 * 24
const KB_ORPHAN_BINDING_WORKSPACE_CHUNK = 50

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
  const [legacyRows, multiContextRows] = await Promise.all([
    selectRowsByIdChunks(workspaceIds, (chunkIds, chunkLimit) =>
      db
        .select({ id: workspaceFile.id, key: workspaceFile.key })
        .from(workspaceFile)
        .where(
          and(
            inArray(workspaceFile.workspaceId, chunkIds),
            isNotNull(workspaceFile.deletedAt),
            lt(workspaceFile.deletedAt, retentionDate)
          )
        )
        .limit(chunkLimit)
    ),
    selectRowsByIdChunks(workspaceIds, (chunkIds, chunkLimit) =>
      db
        .select({
          id: workspaceFiles.id,
          key: workspaceFiles.key,
          context: workspaceFiles.context,
        })
        .from(workspaceFiles)
        .where(
          and(
            inArray(workspaceFiles.workspaceId, chunkIds),
            isNotNull(workspaceFiles.deletedAt),
            lt(workspaceFiles.deletedAt, retentionDate)
          )
        )
        .limit(chunkLimit)
    ),
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

  const keysByContext = new Map<StorageContext, string[]>()
  for (const r of scope.legacyRows) {
    const bucket = keysByContext.get('workspace')
    if (bucket) bucket.push(r.key)
    else keysByContext.set('workspace', [r.key])
  }
  for (const r of scope.multiContextRows) {
    const bucket = keysByContext.get(r.context)
    if (bucket) bucket.push(r.key)
    else keysByContext.set(r.context, [r.key])
  }

  for (const [context, keys] of keysByContext) {
    const result = await StorageService.deleteFiles(keys, context)
    stats.filesDeleted += result.deleted
    stats.filesFailed += result.failed.length
    for (const { key, error } of result.failed) {
      logger.error(`Failed to delete storage file ${key} (context: ${context}):`, { error })
    }
  }

  return stats
}

/**
 * Deletes child rows referencing the given parent ids in bounded batches.
 * Parents with huge `ON DELETE CASCADE` fan-outs (knowledge base → embeddings,
 * table definition → rows) must have their children drained this way BEFORE the
 * parent DELETE runs — one cascading statement can otherwise touch millions of
 * rows and exceed the 60s role-level statement_timeout.
 *
 * Throws when a batch makes no progress so the caller's parent DELETE (and its
 * unbounded cascade) is skipped for this run instead of timing out.
 */
async function deleteChildRowsInBatches(
  childTable: PgTable,
  childIdCol: PgColumn,
  parentFkCol: PgColumn,
  parentIds: string[],
  label: string
): Promise<number> {
  let totalDeleted = 0
  for (const parentChunk of chunkArray(parentIds, DEFAULT_WORKSPACE_CHUNK_SIZE)) {
    while (true) {
      const rows = await db
        .select({ id: sql<string>`id` })
        .from(childTable)
        .where(inArray(parentFkCol, parentChunk))
        .limit(DEFAULT_BATCH_SIZE)
      if (rows.length === 0) break

      const result = await deleteRowsById(
        childTable,
        childIdCol,
        rows.map((r) => r.id),
        label
      )
      totalDeleted += result.deleted
      if (result.deleted === 0) {
        throw new Error(
          `[${label}] Child cleanup made no progress (${rows.length} rows selected, 0 deleted)`
        )
      }
    }
  }
  return totalDeleted
}

interface CleanupTarget {
  table: PgTable
  softDeleteCol: PgColumn
  wsCol: PgColumn
  name: string
  /**
   * Drains child tables with a large `ON DELETE CASCADE` fan-out before the
   * parent rows are deleted — see {@link deleteChildRowsInBatches}.
   */
  prepareCascade?: (rows: Array<{ id: string }>, label: string) => Promise<void>
}

/**
 * Tables cleaned by the generic workspace-scoped batched DELETE. Tables whose
 * hard-delete triggers external side effects (workflow → copilot chats cascade,
 * workspace files → S3 storage) are handled explicitly so the SELECT that drives
 * the external cleanup and the SELECT that drives the DB delete see the same rows.
 */
const CLEANUP_TARGETS: CleanupTarget[] = [
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
    prepareCascade: async (rows, label) => {
      const kbIds = rows.map((r) => r.id)
      // Embeddings first: they cascade from both knowledge_base and document, so
      // draining them makes the subsequent document deletes cascade-free.
      await deleteChildRowsInBatches(
        embedding,
        embedding.id,
        embedding.knowledgeBaseId,
        kbIds,
        `${label}/embedding`
      )
      await deleteChildRowsInBatches(
        document,
        document.id,
        document.knowledgeBaseId,
        kbIds,
        `${label}/document`
      )
    },
  },
  {
    table: userTableDefinitions,
    softDeleteCol: userTableDefinitions.archivedAt,
    wsCol: userTableDefinitions.workspaceId,
    name: 'userTableDefinitions',
    prepareCascade: async (rows, label) => {
      await deleteChildRowsInBatches(
        userTableRows,
        userTableRows.id,
        userTableRows.tableId,
        rows.map((r) => r.id),
        `${label}/userTableRows`
      )
    },
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
]

/**
 * Sweep abandoned knowledge-base ownership bindings. The presigned upload flow
 * writes a `workspace_files` binding when it hands out an upload URL, before the
 * object is stored and before any document is created. If the upload is never
 * completed, that binding is orphaned — no `document.storageKey` ever references
 * its key. Such bindings are inert (read access requires a live document, and
 * the move re-point only follows referenced keys), but they accumulate, so we
 * drop the best-effort object and soft-delete the binding once they are older
 * than the grace window.
 */
async function cleanupOrphanedKnowledgeBaseBindings(
  workspaceIds: string[],
  label: string
): Promise<{ total: number; deleted: number; failed: number }> {
  const stats = { total: 0, deleted: 0, failed: 0 }
  if (workspaceIds.length === 0) return stats

  const orphanCutoff = new Date(Date.now() - KB_ORPHAN_BINDING_GRACE_HOURS * 60 * 60 * 1000)

  for (const chunkIds of chunkArray(workspaceIds, KB_ORPHAN_BINDING_WORKSPACE_CHUNK)) {
    let attempted = 0
    while (attempted < KB_ORPHAN_BINDING_TOTAL_LIMIT) {
      const limit = Math.min(
        KB_ORPHAN_BINDING_BATCH_SIZE,
        KB_ORPHAN_BINDING_TOTAL_LIMIT - attempted
      )
      const rows = await db
        .select({ key: workspaceFiles.key })
        .from(workspaceFiles)
        .where(
          and(
            inArray(workspaceFiles.workspaceId, chunkIds),
            eq(workspaceFiles.context, 'knowledge-base'),
            isNull(workspaceFiles.deletedAt),
            lt(workspaceFiles.uploadedAt, orphanCutoff),
            sql`NOT EXISTS (
              SELECT 1 FROM ${document} AS doc
              WHERE doc.storage_key = ${workspaceFiles.key}
            )`
          )
        )
        .orderBy(asc(workspaceFiles.uploadedAt), asc(workspaceFiles.key))
        .limit(limit)

      if (rows.length === 0) break

      const keys = rows.map((row) => row.key)
      stats.total += keys.length
      attempted += keys.length

      if (isUsingCloudStorage()) {
        const result = await StorageService.deleteFiles(keys, 'knowledge-base')
        stats.failed += result.failed.length
        for (const { key, error } of result.failed) {
          logger.error(`[${label}] Failed to delete orphan KB object ${key}:`, { error })
        }
      }

      let deletedThisBatch = 0
      for (const key of keys) {
        try {
          await deleteFileMetadata(key)
          deletedThisBatch++
        } catch (error) {
          stats.failed++
          logger.error(`[${label}] Failed to delete orphan KB binding ${key}:`, { error })
        }
      }
      stats.deleted += deletedThisBatch

      // No progress (every delete failed) — stop rather than reselect the same rows.
      if (deletedThisBatch === 0) break
    }
  }

  logger.info(
    `[${label}/kb_orphan_bindings] Complete: ${stats.deleted}/${stats.total} bindings cleaned, ${stats.failed} failed`
  )
  return stats
}

export async function runCleanupSoftDeletes(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()
  const { workspaceIds, retentionHours, label } = payload

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
    selectRowsByIdChunks(workspaceIds, (chunkIds, chunkLimit) =>
      db
        .select({ id: workflow.id })
        .from(workflow)
        .where(
          and(
            inArray(workflow.workspaceId, chunkIds),
            isNotNull(workflow.archivedAt),
            lt(workflow.archivedAt, retentionDate)
          )
        )
        .limit(chunkLimit)
    ),
    selectExpiredWorkspaceFiles(workspaceIds, retentionDate),
  ])

  const doomedWorkflowIds = doomedWorkflows.map((w) => w.id)
  let chatCleanup: { execute: () => Promise<void> } | null = null

  if (doomedWorkflowIds.length > 0) {
    const doomedChats = await selectRowsByIdChunks(doomedWorkflowIds, (chunkIds, chunkLimit) =>
      db
        .select({ id: copilotChats.id })
        .from(copilotChats)
        .where(inArray(copilotChats.workflowId, chunkIds))
        .limit(chunkLimit)
    )

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
    const { prepareCascade } = target
    const targetLabel = `${label}/${target.name}`
    const result = await batchDeleteByWorkspaceAndTimestamp({
      tableDef: target.table,
      workspaceIdCol: target.wsCol,
      timestampCol: target.softDeleteCol,
      workspaceIds,
      retentionDate,
      tableName: targetLabel,
      requireTimestampNotNull: true,
      onBatch: prepareCascade ? (rows) => prepareCascade(rows, targetLabel) : undefined,
    })
    totalDeleted += result.deleted
  }

  const orphanBindingStats = await cleanupOrphanedKnowledgeBaseBindings(workspaceIds, label)

  logger.info(
    `[${label}] Complete: ${totalDeleted} rows deleted, ${fileStats.filesDeleted} files cleaned, ${orphanBindingStats.deleted} orphan KB bindings cleaned`
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
  machine: 'large-1x',
  queue: { concurrencyLimit: 5 },
  run: runCleanupSoftDeletes,
})
