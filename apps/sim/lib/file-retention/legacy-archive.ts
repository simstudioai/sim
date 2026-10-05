import { db, dbFor } from '@sim/db'
import { workspaceFile, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import {
  decrementStorageUsageForBillingContextInTx,
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage'
import { DEFAULT_DELETE_CHUNK_SIZE, selectRowsByIdChunks } from '@/lib/cleanup/batch-delete'
import type { CleanupBudgets } from '@/lib/cleanup/limits'
import { type CleanupOwnerScope, cleanupOwnerCondition } from '@/lib/cleanup/resource-scope'
import type { FileArchiveCleanup, FileRetentionOptions } from '@/lib/file-retention/types'
import { lockWorkspaceProject } from '@/lib/projects/membership'
import { isUsingCloudStorage, type StorageContext, StorageService } from '@/lib/uploads'
import { releaseWorkspaceFileVersionsForPurgeInTx } from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'

const logger = createLogger('FileArchiveCleanup')
/** Billing deletion retains the default pool; selection and unbilled cleanup use the cleanup pool. */
const cleanupDb = dbFor('cleanup')

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
  retentionDate: Date,
  budgets?: CleanupBudgets
): Promise<WorkspaceFileScope> {
  const [legacyRows, multiContextRows] = await Promise.all([
    selectRowsByIdChunks(
      scope.kind === 'workspace' ? scope.ids : [],
      (chunkIds, chunkLimit) =>
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
          .limit(chunkLimit),
      { budget: budgets?.legacyFiles }
    ),
    selectRowsByIdChunks(
      scope.ids,
      (chunkIds, chunkLimit) =>
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
          .limit(chunkLimit),
      { budget: budgets?.files }
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
          await lockWorkspaceProject(tx, workspaceId)
          await releaseWorkspaceFileVersionsForPurgeInTx(
            tx,
            batch.map(({ id }) => id),
            retentionDate
          )
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

/** Preserve legacy workspace/multi-context cleanup while selecting each owner batch once. */
export async function prepareLegacyFileArchiveCleanup(
  scope: CleanupOwnerScope,
  { cutoff, budgets, label }: FileRetentionOptions
): Promise<FileArchiveCleanup> {
  const selected = await selectExpiredWorkspaceFiles(scope, cutoff, budgets)
  return {
    async cleanupStorage() {
      const storage = await cleanupWorkspaceFileStorage(selected)
      if (budgets && storage.filesFailed) throw new Error('File storage cleanup failed')
      return {
        filesDeleted: storage.filesDeleted,
        async deleteRows() {
          const legacy = await deleteExpiredLegacyWorkspaceFileRows(
            storage.legacyRows,
            cutoff,
            label
          )
          const billable = await deleteExpiredBillableWorkspaceFileRows(
            storage.multiContextRows,
            cutoff,
            label
          )
          const unbilled = await deleteExpiredUnbilledWorkspaceFileRows(
            storage.multiContextRows,
            cutoff,
            label
          )
          if (budgets && (legacy.failed || billable.failed || unbilled.failed))
            throw new Error('File row cleanup failed')
          return legacy.deleted + billable.deleted + unbilled.deleted
        },
      }
    },
  }
}
