import { db } from '@sim/db'
import { jobExecutionLogs, pausedExecutions, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { and, eq, inArray, isNull, lt, notInArray, or } from 'drizzle-orm'
import { type CleanupJobPayload, resolveCleanupScope } from '@/lib/billing/cleanup-dispatcher'
import {
  batchDeleteByWorkspaceAndTimestamp,
  chunkedBatchDelete,
  type TableCleanupResult,
} from '@/lib/cleanup/batch-delete'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'

const logger = createLogger('CleanupLogs')

interface FileDeleteStats {
  filesTotal: number
  filesDeleted: number
  filesDeleteFailed: number
  largeValuesTotal: number
  largeValuesDeleted: number
  largeValuesDeleteFailed: number
}

const RESUMABLE_PAUSED_STATUSES = ['paused', 'partially_resumed', 'cancelling']

export function collectExecutionLargeValueKeys(value: unknown, executionId: string): string[] {
  const keys = new Set<string>()
  collectExecutionLargeValueKeysInto(value, executionId, new WeakSet<object>(), keys)
  return Array.from(keys)
}

function getExecutionIdFromStorageKey(key: string): string | undefined {
  const parts = key.split('/')
  if (parts[0] !== 'execution' || parts.length < 5) {
    return undefined
  }
  return parts[3]
}

function collectExecutionLargeValueKeysInto(
  value: unknown,
  executionId: string,
  seen: WeakSet<object>,
  keys: Set<string>
): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (seen.has(value)) {
    return
  }

  if (isLargeValueRef(value)) {
    if (value.key && getExecutionIdFromStorageKey(value.key) === executionId) {
      keys.add(value.key)
    }
    return
  }

  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      collectExecutionLargeValueKeysInto(item, executionId, seen, keys)
    }
    return
  }

  for (const entryValue of Object.values(value)) {
    collectExecutionLargeValueKeysInto(entryValue, executionId, seen, keys)
  }
}

async function deleteExecutionFiles(files: unknown, stats: FileDeleteStats): Promise<void> {
  if (!isUsingCloudStorage() || !files || !Array.isArray(files)) return

  const keys = files.filter((f) => f && typeof f === 'object' && f.key).map((f) => f.key as string)
  stats.filesTotal += keys.length

  await Promise.all(
    keys.map(async (key) => {
      try {
        await StorageService.deleteFile({ key, context: 'execution' })
        await deleteFileMetadata(key)
        stats.filesDeleted++
      } catch (fileError) {
        stats.filesDeleteFailed++
        logger.error(`Failed to delete file ${key}:`, { fileError })
      }
    })
  )
}

async function deleteLargeValueStorageKeys(keys: string[], stats: FileDeleteStats): Promise<void> {
  if (!isUsingCloudStorage() || keys.length === 0) return

  const uniqueKeys = Array.from(new Set(keys))
  stats.largeValuesTotal += uniqueKeys.length

  await Promise.all(
    uniqueKeys.map(async (key) => {
      try {
        await StorageService.deleteFile({ key, context: 'execution' })
        await deleteFileMetadata(key)
        stats.largeValuesDeleted++
      } catch (error) {
        stats.largeValuesDeleteFailed++
        logger.error(`Failed to delete large execution value ${key}:`, { error })
      }
    })
  )
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
    largeValuesTotal: 0,
    largeValuesDeleted: 0,
    largeValuesDeleteFailed: 0,
  }

  const dbStats = await chunkedBatchDelete({
    tableDef: workflowExecutionLogs,
    workspaceIds,
    tableName: `${label}/workflow_execution_logs`,
    selectChunk: (chunkIds, limit) =>
      db
        .select({
          id: workflowExecutionLogs.id,
          executionId: workflowExecutionLogs.executionId,
          executionData: workflowExecutionLogs.executionData,
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
        await deleteLargeValueStorageKeys(
          collectExecutionLargeValueKeys(row.executionData, row.executionId),
          fileStats
        )
      }
    },
  })

  return { ...dbStats, ...fileStats }
}

async function cleanupFreePlanOrphanedSnapshots(
  payload: CleanupJobPayload,
  retentionHours: number
): Promise<void> {
  if (payload.plan !== 'free') {
    return
  }

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

  const scope = await resolveCleanupScope('cleanup-logs', payload)
  if (!scope) {
    logger.info(`[${payload.plan}] No retention configured, skipping`)
    return
  }

  const { workspaceIds, retentionHours, label } = scope

  const retentionDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000)

  if (workspaceIds.length === 0) {
    logger.info(`[${label}] No workspaces to process`)
    await cleanupFreePlanOrphanedSnapshots(payload, retentionHours)
    return
  }

  logger.info(
    `[${label}] Cleaning ${workspaceIds.length} workspaces, cutoff: ${retentionDate.toISOString()}`
  )

  const workflowResults = await cleanupWorkflowExecutionLogs(workspaceIds, retentionDate, label)
  logger.info(
    `[${label}] workflow_execution_logs files: ${workflowResults.filesDeleted}/${workflowResults.filesTotal} deleted, ${workflowResults.filesDeleteFailed} failed`
  )
  logger.info(
    `[${label}] workflow_execution_logs large values: ${workflowResults.largeValuesDeleted}/${workflowResults.largeValuesTotal} deleted, ${workflowResults.largeValuesDeleteFailed} failed`
  )

  await batchDeleteByWorkspaceAndTimestamp({
    tableDef: jobExecutionLogs,
    workspaceIdCol: jobExecutionLogs.workspaceId,
    timestampCol: jobExecutionLogs.startedAt,
    workspaceIds,
    retentionDate,
    tableName: `${label}/job_execution_logs`,
  })

  await cleanupFreePlanOrphanedSnapshots(payload, retentionHours)

  const timeElapsed = (Date.now() - startTime) / 1000
  logger.info(`[${label}] Job completed in ${timeElapsed.toFixed(2)}s`)
}

export const cleanupLogsTask = task({
  id: 'cleanup-logs',
  run: runCleanupLogs,
})
