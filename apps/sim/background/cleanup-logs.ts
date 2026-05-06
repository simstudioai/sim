import { db } from '@sim/db'
import { jobExecutionLogs, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { and, inArray, lt } from 'drizzle-orm'
import { type CleanupJobPayload, resolveCleanupScope } from '@/lib/billing/cleanup-dispatcher'
import {
  batchDeleteByWorkspaceAndTimestamp,
  chunkedBatchDelete,
  type TableCleanupResult,
} from '@/lib/cleanup/batch-delete'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'

const logger = createLogger('CleanupLogs')

interface FileDeleteStats {
  filesTotal: number
  filesDeleted: number
  filesDeleteFailed: number
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

async function cleanupWorkflowExecutionLogs(
  workspaceIds: string[],
  retentionDate: Date,
  label: string
): Promise<TableCleanupResult & FileDeleteStats> {
  const fileStats: FileDeleteStats = { filesTotal: 0, filesDeleted: 0, filesDeleteFailed: 0 }

  const dbStats = await chunkedBatchDelete({
    tableDef: workflowExecutionLogs,
    workspaceIds,
    tableName: `${label}/workflow_execution_logs`,
    selectChunk: (chunkIds, limit) =>
      db
        .select({ id: workflowExecutionLogs.id, files: workflowExecutionLogs.files })
        .from(workflowExecutionLogs)
        .where(
          and(
            inArray(workflowExecutionLogs.workspaceId, chunkIds),
            lt(workflowExecutionLogs.startedAt, retentionDate)
          )
        )
        .limit(limit),
    onBatch: async (rows) => {
      for (const row of rows) await deleteExecutionFiles(row.files, fileStats)
    },
  })

  return { ...dbStats, ...fileStats }
}

export async function runCleanupLogs(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()

  const scope = await resolveCleanupScope('cleanup-logs', payload)
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
    `[${label}] Cleaning ${workspaceIds.length} workspaces, cutoff: ${retentionDate.toISOString()}`
  )

  const workflowResults = await cleanupWorkflowExecutionLogs(workspaceIds, retentionDate, label)
  logger.info(
    `[${label}] workflow_execution_logs files: ${workflowResults.filesDeleted}/${workflowResults.filesTotal} deleted, ${workflowResults.filesDeleteFailed} failed`
  )

  await batchDeleteByWorkspaceAndTimestamp({
    tableDef: jobExecutionLogs,
    workspaceIdCol: jobExecutionLogs.workspaceId,
    timestampCol: jobExecutionLogs.startedAt,
    workspaceIds,
    retentionDate,
    tableName: `${label}/job_execution_logs`,
  })

  // Snapshot cleanup runs only on the free job to avoid running it N times for N enterprise workspaces.
  if (payload.plan === 'free') {
    try {
      const retentionDays = Math.floor(retentionHours / 24)
      const snapshotsCleaned = await snapshotService.cleanupOrphanedSnapshots(retentionDays + 1)
      logger.info(`Cleaned up ${snapshotsCleaned} orphaned snapshots`)
    } catch (snapshotError) {
      logger.error('Error cleaning up orphaned snapshots:', { snapshotError })
    }
  }

  const timeElapsed = (Date.now() - startTime) / 1000
  logger.info(`[${label}] Job completed in ${timeElapsed.toFixed(2)}s`)
}

export const cleanupLogsTask = task({
  id: 'cleanup-logs',
  run: runCleanupLogs,
})
