import { db } from '@sim/db'
import {
  executionLargeValues,
  jobExecutionLogs,
  pausedExecutions,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { and, asc, eq, inArray, isNull, lt, notInArray, or } from 'drizzle-orm'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import {
  batchDeleteByWorkspaceAndTimestamp,
  chunkArray,
  chunkedBatchDelete,
  type TableCleanupResult,
} from '@/lib/cleanup/batch-delete'
import {
  markLargeValuesDeleted,
  pruneLargeValueMetadata,
  unreferencedLargeValuePredicate,
} from '@/lib/execution/payloads/large-value-metadata'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'

const logger = createLogger('CleanupLogs')

interface FileDeleteStats {
  filesTotal: number
  filesDeleted: number
  filesDeleteFailed: number
}

const RESUMABLE_PAUSED_STATUSES = ['paused', 'partially_resumed', 'cancelling']

const WORKFLOW_LOG_CLEANUP_BATCH_SIZE = 500
const WORKFLOW_LOG_CLEANUP_MAX_BATCHES = 50
const WORKFLOW_LOG_CLEANUP_ROW_LIMIT =
  WORKFLOW_LOG_CLEANUP_BATCH_SIZE * WORKFLOW_LOG_CLEANUP_MAX_BATCHES
const LOG_CLEANUP_CONCURRENCY_LIMIT = 2
const LARGE_VALUE_CLEANUP_BATCH_SIZE = 500
const LARGE_VALUE_CLEANUP_TOTAL_KEY_LIMIT = 5_000
const LARGE_VALUE_CLEANUP_GRACE_HOURS = 7 * 24
const LARGE_VALUE_TOMBSTONE_RETENTION_HOURS = 30 * 24

async function deleteExecutionFiles(files: unknown, stats: FileDeleteStats): Promise<void> {
  if (!isUsingCloudStorage() || !files || !Array.isArray(files)) return

  const keys = Array.from(
    new Set(files.filter((f) => f && typeof f === 'object' && f.key).map((f) => f.key as string))
  )
  stats.filesTotal += keys.length
  if (keys.length === 0) return

  let result: Awaited<ReturnType<typeof StorageService.deleteFiles>>
  try {
    result = await StorageService.deleteFiles(keys, 'execution')
  } catch (error) {
    stats.filesDeleteFailed += keys.length
    logger.error('Failed to bulk delete execution files:', { error })
    return
  }

  const failedKeys = new Set(result.failed.map(({ key }) => key))
  stats.filesDeleted += result.deleted
  stats.filesDeleteFailed += result.failed.length

  for (const { key, error } of result.failed) {
    logger.error(`Failed to delete file ${key}:`, { error })
  }
  for (const key of keys) {
    if (failedKeys.has(key)) continue
    try {
      await deleteFileMetadata(key)
    } catch (metadataError) {
      stats.filesDeleteFailed++
      logger.error(`Failed to delete file metadata ${key}:`, { metadataError })
    }
  }
}

interface LargeValueCleanupStats {
  largeValuesTotal: number
  largeValuesDeleted: number
  largeValuesDeleteFailed: number
}

async function deleteLargeValueKeys(keys: string[]): Promise<{ deleted: number; failed: number }> {
  if (!isUsingCloudStorage() || keys.length === 0) {
    return { deleted: 0, failed: 0 }
  }

  let result: Awaited<ReturnType<typeof StorageService.deleteFiles>>
  try {
    result = await StorageService.deleteFiles(keys, 'execution')
  } catch (error) {
    logger.error('Failed to bulk delete large execution values:', { error })
    return { deleted: 0, failed: keys.length }
  }

  const failedKeys = new Set(result.failed.map(({ key }) => key))
  const deletedKeys = keys.filter((key) => !failedKeys.has(key))

  if (deletedKeys.length > 0) {
    try {
      await markLargeValuesDeleted(deletedKeys)
    } catch (error) {
      logger.error('Failed to mark large execution values as deleted:', { error })
      return { deleted: 0, failed: result.failed.length + deletedKeys.length }
    }
  }

  for (const { key, error } of result.failed) {
    logger.error(`Failed to delete large execution value ${key}:`, { error })
  }

  for (const key of deletedKeys) {
    try {
      await deleteFileMetadata(key)
    } catch (metadataError) {
      logger.error(`Failed to delete large execution value metadata ${key}:`, { metadataError })
    }
  }

  return { deleted: deletedKeys.length, failed: result.failed.length }
}

async function cleanupLargeExecutionValues(
  workspaceIds: string[],
  retentionDate: Date,
  label: string
): Promise<LargeValueCleanupStats> {
  const stats: LargeValueCleanupStats = {
    largeValuesTotal: 0,
    largeValuesDeleted: 0,
    largeValuesDeleteFailed: 0,
  }
  if (workspaceIds.length === 0) return stats

  const largeValueRetentionDate = new Date(
    retentionDate.getTime() - LARGE_VALUE_CLEANUP_GRACE_HOURS * 60 * 60 * 1000
  )
  const workspaceChunks = chunkArray(workspaceIds, 50)
  let attempted = 0

  for (const chunkIds of workspaceChunks) {
    while (attempted < LARGE_VALUE_CLEANUP_TOTAL_KEY_LIMIT) {
      const limit = Math.min(
        LARGE_VALUE_CLEANUP_BATCH_SIZE,
        LARGE_VALUE_CLEANUP_TOTAL_KEY_LIMIT - attempted
      )
      const rows = await db
        .select({ key: executionLargeValues.key })
        .from(executionLargeValues)
        .where(
          and(
            inArray(executionLargeValues.workspaceId, chunkIds),
            isNull(executionLargeValues.deletedAt),
            lt(executionLargeValues.createdAt, largeValueRetentionDate),
            unreferencedLargeValuePredicate()
          )
        )
        .orderBy(asc(executionLargeValues.createdAt), asc(executionLargeValues.key))
        .limit(limit)

      if (rows.length === 0) break

      const keys = rows.map((row) => row.key)
      stats.largeValuesTotal += keys.length
      attempted += keys.length
      const result = await deleteLargeValueKeys(keys)
      stats.largeValuesDeleted += result.deleted
      stats.largeValuesDeleteFailed += result.failed

      if (result.deleted === 0) {
        break
      }
    }

    if (attempted >= LARGE_VALUE_CLEANUP_TOTAL_KEY_LIMIT) break
  }

  logger.info(
    `[${label}/execution_large_values] Complete: ${stats.largeValuesDeleted}/${stats.largeValuesTotal} deleted, ${stats.largeValuesDeleteFailed} failed`
  )

  return stats
}

async function cleanupLargeValueMetadata(workspaceIds: string[], label: string): Promise<void> {
  try {
    const tombstonesDeletedBefore = new Date(
      Date.now() - LARGE_VALUE_TOMBSTONE_RETENTION_HOURS * 60 * 60 * 1000
    )
    const result = await pruneLargeValueMetadata({ workspaceIds, tombstonesDeletedBefore })
    logger.info(
      `[${label}/execution_large_value_metadata] Pruned ${result.referencesDeleted} stale references, ${result.dependenciesDeleted} dependencies, ${result.tombstonesDeleted} tombstones`
    )
  } catch (error) {
    logger.error(`[${label}/execution_large_value_metadata] Failed to prune metadata`, { error })
  }
}

async function cleanupWorkflowExecutionLogs(
  workspaceIds: string[],
  retentionDate: Date,
  label: string
): Promise<TableCleanupResult & FileDeleteStats> {
  const fileStats: FileDeleteStats = {
    filesTotal: 0,
    filesDeleted: 0,
    filesDeleteFailed: 0,
  }

  const dbStats = await chunkedBatchDelete({
    tableDef: workflowExecutionLogs,
    workspaceIds,
    tableName: `${label}/workflow_execution_logs`,
    selectChunk: (chunkIds, limit) =>
      db
        .select({
          id: workflowExecutionLogs.id,
          files: workflowExecutionLogs.files,
        })
        .from(workflowExecutionLogs)
        .leftJoin(
          pausedExecutions,
          eq(pausedExecutions.executionId, workflowExecutionLogs.executionId)
        )
        .where(
          and(
            inArray(workflowExecutionLogs.workspaceId, chunkIds),
            lt(workflowExecutionLogs.startedAt, retentionDate),
            or(
              isNull(pausedExecutions.status),
              notInArray(pausedExecutions.status, RESUMABLE_PAUSED_STATUSES)
            )
          )
        )
        .limit(limit),
    onBatch: async (rows) => {
      for (const row of rows) {
        await deleteExecutionFiles(row.files, fileStats)
      }
    },
    batchSize: WORKFLOW_LOG_CLEANUP_BATCH_SIZE,
    maxBatches: WORKFLOW_LOG_CLEANUP_MAX_BATCHES,
    totalRowLimit: WORKFLOW_LOG_CLEANUP_ROW_LIMIT,
  })

  return { ...dbStats, ...fileStats }
}

async function cleanupFreePlanOrphanedSnapshots(retentionHours: number): Promise<void> {
  try {
    const retentionDays = Math.floor(retentionHours / 24)
    const snapshotsCleaned = await snapshotService.cleanupOrphanedSnapshots(retentionDays + 1)
    logger.info(`Cleaned up ${snapshotsCleaned} orphaned snapshots`)
  } catch (snapshotError) {
    logger.error('Error cleaning up orphaned snapshots:', { snapshotError })
  }
}

export async function runCleanupLogs(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()
  const { workspaceIds, retentionHours, label, plan, runGlobalHousekeeping } = payload

  const retentionDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000)

  if (workspaceIds.length === 0) {
    logger.info(`[${label}] No workspaces to process`)
    if (runGlobalHousekeeping && plan === 'free') {
      await cleanupFreePlanOrphanedSnapshots(retentionHours)
    }
    return
  }

  logger.info(
    `[${label}] Cleaning ${workspaceIds.length} workspaces, cutoff: ${retentionDate.toISOString()}`
  )

  const workflowResults = await cleanupWorkflowExecutionLogs(workspaceIds, retentionDate, label)
  logger.info(
    `[${label}] workflow_execution_logs files: ${workflowResults.filesDeleted}/${workflowResults.filesTotal} deleted, ${workflowResults.filesDeleteFailed} failed`
  )
  const largeValueResults = await cleanupLargeExecutionValues(workspaceIds, retentionDate, label)
  logger.info(
    `[${label}] workflow_execution_logs large values: ${largeValueResults.largeValuesDeleted}/${largeValueResults.largeValuesTotal} deleted, ${largeValueResults.largeValuesDeleteFailed} failed`
  )
  await cleanupLargeValueMetadata(workspaceIds, label)

  await batchDeleteByWorkspaceAndTimestamp({
    tableDef: jobExecutionLogs,
    workspaceIdCol: jobExecutionLogs.workspaceId,
    timestampCol: jobExecutionLogs.startedAt,
    workspaceIds,
    retentionDate,
    tableName: `${label}/job_execution_logs`,
  })

  if (runGlobalHousekeeping && plan === 'free') {
    await cleanupFreePlanOrphanedSnapshots(retentionHours)
  }

  const timeElapsed = (Date.now() - startTime) / 1000
  logger.info(`[${label}] Job completed in ${timeElapsed.toFixed(2)}s`)
}

export const cleanupLogsTask = task({
  id: 'cleanup-logs',
  machine: 'large-1x',
  queue: { concurrencyLimit: LOG_CLEANUP_CONCURRENCY_LIMIT },
  run: runCleanupLogs,
})
