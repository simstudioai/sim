import { db, dbFor } from '@sim/db'
import {
  copilotChats,
  document,
  folder as folderTable,
  knowledgeBase,
  mcpServers,
  memory,
  userTableDefinitions,
  workflow,
  workflowMcpServer,
  workspaceFile,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { task } from '@trigger.dev/sdk'
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import {
  decrementStorageUsageForBillingContextInTx,
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage'
import {
  batchDeleteByWorkspaceAndTimestamp,
  chunkedBatchDelete,
  chunkedBatchDeleteByScope,
  DEFAULT_DELETE_CHUNK_SIZE,
  selectRowsByIdChunks,
} from '@/lib/cleanup/batch-delete'
import { prepareChatCleanup } from '@/lib/cleanup/chat-cleanup'
import {
  type CleanupOwnerScope,
  cleanupOwnerCondition,
  resolveCleanupOwnerScope,
} from '@/lib/cleanup/resource-scope'
import { deduplicateFolderName } from '@/lib/folders/naming'
import { hardDeleteDocuments } from '@/lib/knowledge/documents/service'
import type { StorageContext } from '@/lib/uploads'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'
import { allocateUniqueWorkspaceFileName } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'

const logger = createLogger('CleanupSoftDeletes')

/**
 * Cleanup queries run on the dedicated cleanup pool. The one exception is the
 * billable-file transaction below, which couples row deletion with a storage
 * billing decrement — billing writes stay on the default client.
 */
const cleanupDb = dbFor('cleanup')

const KB_ORPHAN_BINDING_BATCH_SIZE = 500
const KB_ORPHAN_BINDING_TOTAL_LIMIT = 5_000
/**
 * Grace window before an unreferenced KB binding is swept. Comfortably longer
 * than any presign → upload → document-insert flow, so an in-flight upload is
 * never mistaken for an abandoned one.
 */
const KB_ORPHAN_BINDING_GRACE_HOURS = 7 * 24
const KB_ORPHAN_BINDING_OWNER_CHUNK_SIZE = 50
const KB_RETENTION_BATCH_SIZE = 100
const KB_DOCUMENT_DELETE_BATCH_SIZE = 500
const KB_DOCUMENT_DELETE_MAX_BATCHES = 50

interface WorkspaceFileScope {
  /** Rows from `workspace_file` (singular, legacy workspace-context only). */
  legacyRows: Array<{ id: string; key: string; workspaceId: string }>
  /** Rows from `workspace_files` (plural, multi-context). */
  multiContextRows: Array<{
    id: string
    key: string
    workspaceId: string | null
    context: StorageContext
    size: number
  }>
}

interface WorkspaceFileStorageCleanupResult {
  filesDeleted: number
  filesFailed: number
  legacyRows: WorkspaceFileScope['legacyRows']
  multiContextRows: WorkspaceFileScope['multiContextRows']
}

/**
 * Select every soft-deleted file row that's eligible for permanent removal.
 * Returned once and reused for both S3 deletion and DB deletion so the external
 * cleanup cannot drift from the row-level cleanup.
 */
async function selectExpiredWorkspaceFiles(
  scope: CleanupOwnerScope,
  retentionDate: Date
): Promise<WorkspaceFileScope> {
  const [legacyRows, multiContextRows] = await Promise.all([
    selectRowsByIdChunks(scope.kind === 'workspace' ? scope.ids : [], (chunkIds, chunkLimit) =>
      cleanupDb
        .select({
          id: workspaceFile.id,
          key: workspaceFile.key,
          workspaceId: workspaceFile.workspaceId,
        })
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
    selectRowsByIdChunks(scope.ids, (chunkIds, chunkLimit) =>
      cleanupDb
        .select({
          id: workspaceFiles.id,
          key: workspaceFiles.key,
          workspaceId: workspaceFiles.workspaceId,
          context: workspaceFiles.context,
          sizeBytes: workspaceFiles.sizeBytes,
        })
        .from(workspaceFiles)
        .where(
          and(
            cleanupOwnerCondition(workspaceFiles, scope, chunkIds),
            scope.kind === 'organization'
              ? eq(workspaceFiles.context, 'knowledge-base')
              : undefined,
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
      workspaceId: r.workspaceId,
      context: r.context as StorageContext,
      size: getWorkspaceFileSize(r),
    })),
  }
}

async function cleanupWorkspaceFileStorage(
  scope: WorkspaceFileScope
): Promise<WorkspaceFileStorageCleanupResult> {
  type Candidate =
    | { source: 'legacy'; context: StorageContext; row: WorkspaceFileScope['legacyRows'][number] }
    | {
        source: 'multiContext'
        context: StorageContext
        row: WorkspaceFileScope['multiContextRows'][number]
      }

  const result: WorkspaceFileStorageCleanupResult = {
    filesDeleted: 0,
    filesFailed: 0,
    legacyRows: [],
    multiContextRows: [],
  }
  if (!isUsingCloudStorage()) {
    return {
      ...result,
      legacyRows: scope.legacyRows,
      multiContextRows: scope.multiContextRows,
    }
  }

  const candidatesByContext = new Map<StorageContext, Candidate[]>()
  const addCandidate = (candidate: Candidate) => {
    const bucket = candidatesByContext.get(candidate.context)
    if (bucket) bucket.push(candidate)
    else candidatesByContext.set(candidate.context, [candidate])
  }
  for (const row of scope.legacyRows) {
    addCandidate({ source: 'legacy', context: 'workspace', row })
  }
  for (const row of scope.multiContextRows) {
    addCandidate({ source: 'multiContext', context: row.context, row })
  }

  for (const [context, candidates] of candidatesByContext) {
    for (const batch of chunkArray(candidates, DEFAULT_DELETE_CHUNK_SIZE)) {
      const deletion = await StorageService.deleteFiles(
        batch.map(({ row }) => row.key),
        context
      )
      const failedKeys = new Set(deletion.failed.map(({ key }) => key))
      result.filesDeleted += batch.filter(({ row }) => !failedKeys.has(row.key)).length
      result.filesFailed += deletion.failed.length

      for (const candidate of batch) {
        if (failedKeys.has(candidate.row.key)) continue
        if (candidate.source === 'legacy') result.legacyRows.push(candidate.row)
        else result.multiContextRows.push(candidate.row)
      }
      for (const { key, error } of deletion.failed) {
        logger.error(`Failed to delete storage file ${key} (context: ${context}):`, { error })
      }
    }
  }

  return result
}

async function deleteExpiredLegacyWorkspaceFileRows(
  rows: WorkspaceFileScope['legacyRows'],
  retentionDate: Date,
  label: string
): Promise<{ deleted: number; failed: number }> {
  const result = { deleted: 0, failed: 0 }
  for (const batch of chunkArray(rows, DEFAULT_DELETE_CHUNK_SIZE)) {
    try {
      const deleted = await cleanupDb
        .delete(workspaceFile)
        .where(
          and(
            inArray(
              workspaceFile.id,
              batch.map(({ id }) => id)
            ),
            isNotNull(workspaceFile.deletedAt),
            lt(workspaceFile.deletedAt, retentionDate)
          )
        )
        .returning({ id: workspaceFile.id })
      result.deleted += deleted.length
      result.failed += batch.length - deleted.length
    } catch (error) {
      result.failed += batch.length
      logger.error(`[${label}/workspaceFile] Exact-row delete failed`, { error })
    }
  }
  return result
}

async function deleteExpiredUnbilledWorkspaceFileRows(
  rows: WorkspaceFileScope['multiContextRows'],
  retentionDate: Date,
  label: string
): Promise<{ deleted: number; failed: number }> {
  const result = { deleted: 0, failed: 0 }
  const rowsByContext = new Map<StorageContext, WorkspaceFileScope['multiContextRows']>()
  for (const row of rows) {
    if (row.context === 'workspace') continue
    const bucket = rowsByContext.get(row.context)
    if (bucket) bucket.push(row)
    else rowsByContext.set(row.context, [row])
  }

  for (const [context, contextRows] of rowsByContext) {
    for (const batch of chunkArray(contextRows, DEFAULT_DELETE_CHUNK_SIZE)) {
      try {
        const deleted = await cleanupDb
          .delete(workspaceFiles)
          .where(
            and(
              inArray(
                workspaceFiles.id,
                batch.map(({ id }) => id)
              ),
              eq(workspaceFiles.context, context),
              isNotNull(workspaceFiles.deletedAt),
              lt(workspaceFiles.deletedAt, retentionDate)
            )
          )
          .returning({ id: workspaceFiles.id })
        result.deleted += deleted.length
        result.failed += batch.length - deleted.length
      } catch (error) {
        result.failed += batch.length
        logger.error(`[${label}/workspaceFiles] Exact-row ${context} delete failed`, { error })
      }
    }
  }
  return result
}

async function deleteExpiredBillableWorkspaceFileRows(
  rows: WorkspaceFileScope['multiContextRows'],
  retentionDate: Date,
  label: string
): Promise<{ deleted: number; failed: number }> {
  const result = { deleted: 0, failed: 0 }
  const rowsByWorkspace = new Map<string, WorkspaceFileScope['multiContextRows']>()
  for (const row of rows) {
    if (row.context !== 'workspace') continue
    if (!row.workspaceId) {
      result.failed++
      logger.error(`[${label}/workspaceFiles] Billable row has no workspace attribution`, {
        fileId: row.id,
      })
      continue
    }
    const bucket = rowsByWorkspace.get(row.workspaceId)
    if (bucket) bucket.push(row)
    else rowsByWorkspace.set(row.workspaceId, [row])
  }

  for (const [workspaceId, workspaceRows] of rowsByWorkspace) {
    let billingContext: StorageBillingContext
    try {
      billingContext = await resolveStorageBillingContext(workspaceId)
    } catch (error) {
      result.failed += workspaceRows.length
      logger.error(`[${label}/workspaceFiles] Failed to resolve current storage payer`, {
        error,
        workspaceId,
      })
      continue
    }

    for (const batch of chunkArray(workspaceRows, DEFAULT_DELETE_CHUNK_SIZE)) {
      try {
        const deletedCount = await db.transaction(async (tx) => {
          const deletedRows = await tx
            .delete(workspaceFiles)
            .where(
              and(
                inArray(
                  workspaceFiles.id,
                  batch.map(({ id }) => id)
                ),
                eq(workspaceFiles.workspaceId, workspaceId),
                eq(workspaceFiles.context, 'workspace'),
                isNotNull(workspaceFiles.deletedAt),
                lt(workspaceFiles.deletedAt, retentionDate)
              )
            )
            .returning({
              id: workspaceFiles.id,
              sizeBytes: workspaceFiles.sizeBytes,
            })
          const deletedBytes = deletedRows.reduce(
            (total, row) => total + getWorkspaceFileSize(row),
            0
          )
          await decrementStorageUsageForBillingContextInTx(tx, billingContext, deletedBytes)
          return deletedRows.length
        })
        result.deleted += deletedCount
        result.failed += batch.length - deletedCount
      } catch (error) {
        result.failed += batch.length
        logger.error(`[${label}/workspaceFiles] Atomic delete and decrement failed`, {
          error,
          workspaceId,
        })
      }
    }
  }
  return result
}

async function hardDeleteKnowledgeBaseDocuments(
  knowledgeBaseIds: string[],
  label: string
): Promise<void> {
  for (let batch = 0; batch < KB_DOCUMENT_DELETE_MAX_BATCHES; batch++) {
    const documentRows = await cleanupDb
      .select({ id: document.id })
      .from(document)
      .where(inArray(document.knowledgeBaseId, knowledgeBaseIds))
      .orderBy(asc(document.id))
      .limit(KB_DOCUMENT_DELETE_BATCH_SIZE)
    if (documentRows.length === 0) return

    const documentIds = documentRows.map(({ id }) => id)
    const deleted = await hardDeleteDocuments(documentIds, `${label}/knowledgeBase`)
    if (deleted === 0) {
      throw new Error('Knowledge-base document hard-delete made no progress')
    }
  }

  const remaining = await cleanupDb
    .select({ id: document.id })
    .from(document)
    .where(inArray(document.knowledgeBaseId, knowledgeBaseIds))
    .limit(1)
  if (remaining.length > 0) {
    throw new Error('Knowledge-base document hard-delete batch limit reached')
  }
}

async function cleanupExpiredKnowledgeBases(
  scope: CleanupOwnerScope,
  retentionDate: Date,
  label: string
) {
  const options = {
    tableDef: knowledgeBase,
    tableName: `${label}/knowledgeBase`,
    batchSize: KB_RETENTION_BATCH_SIZE,
    dbClient: cleanupDb,
    selectChunk: (chunkIds: string[], limit: number) =>
      cleanupDb
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(
          and(
            cleanupOwnerCondition(knowledgeBase, scope, chunkIds),
            isNotNull(knowledgeBase.deletedAt),
            lt(knowledgeBase.deletedAt, retentionDate)
          )
        )
        .limit(limit),
    /**
     * Re-asserted on the DELETE because `onBatch` hard-deletes documents first, which leaves a
     * real window in which a restore can land.
     *
     * This narrows the window rather than closing it: the base row survives, but documents
     * already hard-deleted by `onBatch` do not come back, so a restore landing mid-batch
     * returns an emptied knowledge base. Closing it properly means holding a row lock across
     * select → onBatch → delete.
     */
    deleteFilter: and(
      cleanupOwnerCondition(knowledgeBase, scope),
      isNotNull(knowledgeBase.deletedAt),
      lt(knowledgeBase.deletedAt, retentionDate)
    ),
    onBatch: (rows: { id: string }[]) =>
      hardDeleteKnowledgeBaseDocuments(
        rows.map(({ id }) => id),
        label
      ),
  }
  return scope.kind === 'workspace'
    ? chunkedBatchDelete({ ...options, workspaceIds: scope.ids })
    : chunkedBatchDeleteByScope({ ...options, scopeIds: scope.ids })
}

/**
 * Tables cleaned by the generic workspace-scoped batched DELETE. Tables whose
 * hard-delete triggers external side effects (workflow → copilot chats cascade,
 * workspace files → S3 storage) are handled explicitly so the SELECT that drives
 * the external cleanup and the SELECT that drives the DB delete see the same rows.
 */
/** Per-run values an `onBatch` hook needs but `CLEANUP_TARGETS` cannot know at module scope. */
interface CleanupBatchContext {
  retentionDate: Date
  label: string
}

/**
 * Applies one re-root, treating the deduplicated name as a HINT rather than a guarantee.
 *
 * Both name allocators can hand back a name that is already taken: `fileExistsInWorkspace`
 * swallows query errors and returns `false`, so `allocateUniqueWorkspaceFileName` fails OPEN,
 * and `deduplicateWorkflowName`'s lookups can throw outright. Either way the UPDATE raises
 * 23505, and an uncaught 23505 here aborts the batch — precisely the permanent retention stall
 * this whole hook exists to prevent. So any failure retries with the row id, which is unique by
 * construction and cannot collide.
 *
 * A failure of that retry is swallowed too: one unfixable row must not stop the other children
 * from being made safe. It is logged at error level because the folder's DELETE can then still
 * stall on that row via the FK's SET NULL.
 */
async function reRootOne(
  preferred: () => Promise<unknown>,
  withUniqueName: () => Promise<unknown>,
  subject: string,
  label: string
): Promise<void> {
  try {
    await preferred()
    return
  } catch (error) {
    logger.warn(`[${label}] Re-rooting ${subject} under its deduplicated name failed; retrying`, {
      error,
    })
  }

  try {
    await withUniqueName()
  } catch (error) {
    logger.error(`[${label}] Could not re-root ${subject}; its folder delete may stall`, { error })
  }
}

/**
 * Re-roots any still-active workflow or workspace file filed under a folder that is about to be
 * hard-deleted, giving it a collision-free name first.
 *
 * The `folder_id` FKs are `ON DELETE SET NULL`, so Postgres already re-roots these rows on its
 * own. The problem is the name: both tables carry a partial unique index keyed on
 * `coalesce(folder_id, '')`, so an implicit SET NULL can land a row on a name the workspace root
 * already holds and abort the whole DELETE with a 23505. `chunkedBatchDelete` counts that as a
 * failed batch and stops, and the same poison row re-fails on every later run — folder retention
 * would stall permanently for that workspace chunk. Renaming here leaves the SET NULL a no-op.
 *
 * An active child inside a soft-deleted folder is already an anomaly — the delete cascade
 * archives children — so this normally selects nothing, which is why the per-row loop is fine.
 */
async function reRootActiveFolderChildren(
  folderIds: string[],
  retentionDate: Date,
  label: string
): Promise<void> {
  if (folderIds.length === 0) return
  /**
   * The SELECTs below are guarded for the same reason `reRootOne` swallows: this hook rejecting
   * IS the aborted batch it exists to prevent. A transient read failure should leave the DELETE
   * to succeed or fail on its own merits, not turn into a guaranteed stall.
   */
  try {
    await reRootActiveFolderChildrenUnguarded(folderIds, retentionDate, label)
  } catch (error) {
    logger.error(`[${label}] Re-rooting children of purged folders failed`, { error })
  }
}

async function reRootActiveFolderChildrenUnguarded(
  folderIds: string[],
  retentionDate: Date,
  label: string
): Promise<void> {
  /**
   * Re-asserted here, not just on the DELETE. `deleteFilter` already skips a folder restored
   * between the SELECT and this hook — but without the same check here, this hook would still
   * strip and rename the children of a folder that then survives, leaving a live folder
   * emptied out. Every other side effect in this sweep only touches rows that are on their way
   * out; this one mutates rows that stay, so it is the one place where losing that race is
   * visible to the user.
   *
   * This narrows the window to match the DELETE's own re-assertion rather than closing it.
   * Closing it properly means holding a row lock across select → onBatch → delete, which
   * nothing in this sweep does today.
   */
  const stillExpired = await cleanupDb
    .select({ id: folderTable.id })
    .from(folderTable)
    .where(
      and(
        inArray(folderTable.id, folderIds),
        isNotNull(folderTable.deletedAt),
        lt(folderTable.deletedAt, retentionDate)
      )
    )

  const expiredIds = stillExpired.map(({ id }) => id)
  if (expiredIds.length === 0) return

  const workflows = await cleanupDb
    .select({ id: workflow.id, name: workflow.name, workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(and(inArray(workflow.folderId, expiredIds), isNull(workflow.archivedAt)))

  for (const row of workflows) {
    const workspaceId = row.workspaceId
    if (!workspaceId) continue
    await reRootOne(
      async () => {
        const name = await deduplicateWorkflowName(row.name, workspaceId, null, cleanupDb)
        await cleanupDb
          .update(workflow)
          .set({ folderId: null, name })
          .where(eq(workflow.id, row.id))
      },
      () =>
        cleanupDb
          .update(workflow)
          .set({ folderId: null, name: `${row.name} (${row.id})` })
          .where(eq(workflow.id, row.id)),
      `workflow ${row.id}`,
      label
    )
  }

  const files = await cleanupDb
    .select({
      id: workspaceFiles.id,
      originalName: workspaceFiles.originalName,
      workspaceId: workspaceFiles.workspaceId,
    })
    .from(workspaceFiles)
    .where(
      and(
        inArray(workspaceFiles.folderId, expiredIds),
        isNull(workspaceFiles.deletedAt),
        eq(workspaceFiles.context, 'workspace')
      )
    )

  for (const row of files) {
    const workspaceId = row.workspaceId
    if (!workspaceId) continue
    await reRootOne(
      async () => {
        const originalName = await allocateUniqueWorkspaceFileName(
          workspaceId,
          row.originalName,
          null
        )
        await cleanupDb
          .update(workspaceFiles)
          .set({ folderId: null, originalName })
          .where(eq(workspaceFiles.id, row.id))
      },
      () =>
        cleanupDb
          .update(workspaceFiles)
          .set({ folderId: null, originalName: `${row.originalName} (${row.id})` })
          .where(eq(workspaceFiles.id, row.id)),
      `workspace file ${row.id}`,
      label
    )
  }

  /**
   * Subfolders are exposed to exactly the same failure. `folder.parentId` is itself
   * `ON DELETE SET NULL`, and `folder_workspace_resource_parent_name_active_unique` keys on
   * `coalesce(parent_id, '')`, so purging a parent re-roots a surviving active child into a
   * namespace where its name may already be taken — the identical 23505 stall. Covering only
   * workflows and files would leave the class half-closed.
   */
  const childFolders = await cleanupDb
    .select({
      id: folderTable.id,
      name: folderTable.name,
      workspaceId: folderTable.workspaceId,
      resourceType: folderTable.resourceType,
    })
    .from(folderTable)
    .where(and(inArray(folderTable.parentId, expiredIds), isNull(folderTable.deletedAt)))

  for (const row of childFolders) {
    await reRootOne(
      async () => {
        const name = await deduplicateFolderName(
          cleanupDb,
          row.workspaceId,
          null,
          row.name,
          row.resourceType
        )
        await cleanupDb
          .update(folderTable)
          .set({ parentId: null, name })
          .where(eq(folderTable.id, row.id))
      },
      () =>
        cleanupDb
          .update(folderTable)
          .set({ parentId: null, name: `${row.name} (${row.id})` })
          .where(eq(folderTable.id, row.id)),
      `folder ${row.id}`,
      label
    )
  }

  if (workflows.length > 0 || files.length > 0) {
    logger.warn(
      `[${label}] Re-rooted ${workflows.length} workflow(s) and ${files.length} file(s) out of folders being purged`
    )
  }
}

const CLEANUP_TARGETS = [
  {
    table: folderTable,
    softDeleteCol: folderTable.deletedAt,
    wsCol: folderTable.workspaceId,
    /**
     * `folder` is shared by all four resource types, every one of which now writes here.
     * The predicate is kept (rather than dropped) so a resource type added to the enum
     * before its cutover lands is not silently hard-deleted by this pass. One widened
     * predicate rather than a target per type: same table, same soft-delete column, same
     * workspace scoping — splitting it would only multiply the batched scans.
     */
    additionalPredicate: inArray(folderTable.resourceType, [
      'workflow',
      'file',
      'knowledge_base',
      'table',
    ]),
    onBatch: (rows: { id: string }[], ctx: CleanupBatchContext) =>
      reRootActiveFolderChildren(
        rows.map(({ id }) => id),
        ctx.retentionDate,
        ctx.label
      ),
    name: 'folder',
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
] as const

/**
 * Sweep abandoned knowledge-base ownership bindings. Knowledge upload sessions write a
 * `workspace_files` binding before the object is stored and before any document is created.
 * If the upload is never completed, that binding is orphaned — no
 * `document.storageKey` ever references its key. Such bindings are inert (read access requires
 * a live document, and the move re-point only follows referenced keys), but they accumulate,
 * so we drop the best-effort object and soft-delete the binding once they are older than the
 * grace window.
 */
async function cleanupOrphanedKnowledgeBaseBindings(
  scope: CleanupOwnerScope,
  label: string
): Promise<{ total: number; deleted: number; failed: number }> {
  const stats = { total: 0, deleted: 0, failed: 0 }
  if (scope.ids.length === 0) return stats

  const orphanCutoff = new Date(Date.now() - KB_ORPHAN_BINDING_GRACE_HOURS * 60 * 60 * 1000)

  for (const chunkIds of chunkArray(scope.ids, KB_ORPHAN_BINDING_OWNER_CHUNK_SIZE)) {
    let attempted = 0
    while (attempted < KB_ORPHAN_BINDING_TOTAL_LIMIT) {
      const limit = Math.min(
        KB_ORPHAN_BINDING_BATCH_SIZE,
        KB_ORPHAN_BINDING_TOTAL_LIMIT - attempted
      )
      const rows = await cleanupDb
        .select({ key: workspaceFiles.key })
        .from(workspaceFiles)
        .where(
          and(
            cleanupOwnerCondition(workspaceFiles, scope, chunkIds),
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

      let deletableKeys = keys
      if (isUsingCloudStorage()) {
        const result = await StorageService.deleteFiles(keys, 'knowledge-base')
        stats.failed += result.failed.length
        const failedKeys = new Set(result.failed.map(({ key }) => key))
        deletableKeys = keys.filter((key) => !failedKeys.has(key))
        for (const { key, error } of result.failed) {
          logger.error(`[${label}] Failed to delete orphan KB object ${key}:`, { error })
        }
      }

      let deletedThisBatch = 0
      for (const key of deletableKeys) {
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
  const scope = resolveCleanupOwnerScope(payload)

  if (scope.ids.length === 0) {
    logger.info(`[${label}] No resource owners to process`)
    return
  }

  const retentionDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  logger.info(
    `[${label}] Processing ${scope.ids.length} ${scope.kind} owners, cutoff: ${retentionDate.toISOString()}`
  )

  // Select workflows + files + soft-deleted chats once. These sets drive BOTH
  // external cleanup (chats + S3) AND the DB deletes below — selecting twice
  // could return different subsets above the LIMIT cap and orphan or
  // prematurely purge data.
  const [doomedWorkflows, fileScope, expiredSoftDeletedChats] = await Promise.all([
    selectRowsByIdChunks(workspaceIds, (chunkIds, chunkLimit) =>
      cleanupDb
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
    selectExpiredWorkspaceFiles(scope, retentionDate),
    selectRowsByIdChunks(scope.ids, (chunkIds, chunkLimit) =>
      cleanupDb
        .select({ id: copilotChats.id })
        .from(copilotChats)
        .where(
          and(
            cleanupOwnerCondition(copilotChats, scope, chunkIds),
            isNotNull(copilotChats.deletedAt),
            lt(copilotChats.deletedAt, retentionDate)
          )
        )
        .limit(chunkLimit)
    ),
  ])

  const doomedWorkflowIds = doomedWorkflows.map((w) => w.id)
  const softDeletedChatIds = expiredSoftDeletedChats.map((c) => c.id)
  let chatCleanup: { execute: () => Promise<void> } | null = null

  const doomedChatIds = new Set(softDeletedChatIds)
  if (doomedWorkflowIds.length > 0) {
    const workflowChats = await selectRowsByIdChunks(doomedWorkflowIds, (chunkIds, chunkLimit) =>
      cleanupDb
        .select({ id: copilotChats.id })
        .from(copilotChats)
        .where(inArray(copilotChats.workflowId, chunkIds))
        .limit(chunkLimit)
    )
    for (const chat of workflowChats) {
      doomedChatIds.add(chat.id)
    }
  }
  if (doomedChatIds.size > 0) {
    chatCleanup = await prepareChatCleanup([...doomedChatIds], label)
  }

  const fileCleanup = await cleanupWorkspaceFileStorage(fileScope)

  let totalDeleted = 0

  // Delete the workflow + file rows using the exact IDs we already selected.
  // Re-check the archive cutoff in the DELETE so a workflow restored between
  // selection and this point survives — and with it, its chats: their rows are
  // never cascaded, so chatCleanup.execute()'s row-existence re-check also
  // spares their backend data and files.
  for (const batch of chunkArray(doomedWorkflowIds, DEFAULT_DELETE_CHUNK_SIZE)) {
    try {
      const deleted = await cleanupDb
        .delete(workflow)
        .where(
          and(
            inArray(workflow.id, batch),
            isNotNull(workflow.archivedAt),
            lt(workflow.archivedAt, retentionDate)
          )
        )
        .returning({ id: workflow.id })
      totalDeleted += deleted.length
    } catch (error) {
      logger.error(`[${label}/workflow] Archived workflow delete failed`, { error })
    }
  }

  // Workflow-scoped chats above are removed by the workflow FK cascade;
  // soft-deleted mothership chats have no workflow and need their own delete.
  // Re-check the soft-delete cutoff in the DELETE itself so a chat restored
  // between selection and this point survives (chatCleanup.execute() below
  // also re-checks row existence before purging external data).
  for (const batch of chunkArray(softDeletedChatIds, DEFAULT_DELETE_CHUNK_SIZE)) {
    try {
      const deleted = await cleanupDb
        .delete(copilotChats)
        .where(
          and(
            inArray(copilotChats.id, batch),
            cleanupOwnerCondition(copilotChats, scope),
            isNotNull(copilotChats.deletedAt),
            lt(copilotChats.deletedAt, retentionDate)
          )
        )
        .returning({ id: copilotChats.id })
      totalDeleted += deleted.length
    } catch (error) {
      logger.error(`[${label}/copilotChats] Soft-deleted chat delete failed`, { error })
    }
  }

  const legacyFileResult = await deleteExpiredLegacyWorkspaceFileRows(
    fileCleanup.legacyRows,
    retentionDate,
    label
  )
  totalDeleted += legacyFileResult.deleted

  const billableFileResult = await deleteExpiredBillableWorkspaceFileRows(
    fileCleanup.multiContextRows,
    retentionDate,
    label
  )
  totalDeleted += billableFileResult.deleted

  const unbilledFileResult = await deleteExpiredUnbilledWorkspaceFileRows(
    fileCleanup.multiContextRows,
    retentionDate,
    label
  )
  totalDeleted += unbilledFileResult.deleted

  const knowledgeBaseResult = await cleanupExpiredKnowledgeBases(scope, retentionDate, label)
  totalDeleted += knowledgeBaseResult.deleted

  for (const target of scope.kind === 'workspace' ? CLEANUP_TARGETS : []) {
    const result = await batchDeleteByWorkspaceAndTimestamp({
      tableDef: target.table,
      workspaceIdCol: target.wsCol,
      timestampCol: target.softDeleteCol,
      workspaceIds,
      retentionDate,
      tableName: `${label}/${target.name}`,
      requireTimestampNotNull: true,
      additionalPredicate: 'additionalPredicate' in target ? target.additionalPredicate : undefined,
      onBatch:
        'onBatch' in target
          ? (rows: { id: string }[]) => target.onBatch(rows, { retentionDate, label })
          : undefined,
      dbClient: cleanupDb,
    })
    totalDeleted += result.deleted
  }

  const orphanBindingStats = await cleanupOrphanedKnowledgeBaseBindings(scope, label)

  logger.info(
    `[${label}] Complete: ${totalDeleted} rows deleted, ${fileCleanup.filesDeleted} files cleaned, ${orphanBindingStats.deleted} orphan KB bindings cleaned`
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
