import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { and, inArray, lt } from 'drizzle-orm'
import { type CleanupJobPayload, resolveCleanupScope } from '@/lib/billing/cleanup-dispatcher'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'

const logger = createLogger('CleanupLogs')

const BATCH_SIZE = 2000
const MAX_BATCHES_PER_TIER = 10

interface TierResults {
  total: number
  deleted: number
  deleteFailed: number
  filesTotal: number
  filesDeleted: number
  filesDeleteFailed: number
}

function emptyTierResults(): TierResults {
  return {
    total: 0,
    deleted: 0,
    deleteFailed: 0,
    filesTotal: 0,
    filesDeleted: 0,
    filesDeleteFailed: 0,
  }
}

async function deleteExecutionFiles(files: unknown, results: TierResults): Promise<void> {
  if (!isUsingCloudStorage() || !files || !Array.isArray(files)) return

  const keys = files.filter((f) => f && typeof f === 'object' && f.key).map((f) => f.key as string)
  results.filesTotal += keys.length

  await Promise.all(
    keys.map(async (key) => {
      try {
        await StorageService.deleteFile({ key, context: 'execution' })
        await deleteFileMetadata(key)
        results.filesDeleted++
      } catch (fileError) {
        results.filesDeleteFailed++
        logger.error(`Failed to delete file ${key}:`, { fileError })
      }
    })
  )
}

async function cleanupTier(
  workspaceIds: string[],
  retentionDate: Date,
  label: string
): Promise<TierResults> {
  const results = emptyTierResults()
  if (workspaceIds.length === 0) return results

  let batchesProcessed = 0
  let hasMore = true

  while (hasMore && batchesProcessed < MAX_BATCHES_PER_TIER) {
    const batch = await db
      .select({
        id: workflowExecutionLogs.id,
        files: workflowExecutionLogs.files,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          inArray(workflowExecutionLogs.workspaceId, workspaceIds),
          lt(workflowExecutionLogs.startedAt, retentionDate)
        )
      )
      .limit(BATCH_SIZE)

    results.total += batch.length

    if (batch.length === 0) {
      hasMore = false
      break
    }

    for (const log of batch) {
      await deleteExecutionFiles(log.files, results)
    }

    const logIds = batch.map((log) => log.id)
    try {
      const deleted = await db
        .delete(workflowExecutionLogs)
        .where(inArray(workflowExecutionLogs.id, logIds))
        .returning({ id: workflowExecutionLogs.id })

      results.deleted += deleted.length
    } catch (deleteError) {
      results.deleteFailed += logIds.length
      logger.error(`Batch delete failed for ${label}:`, { deleteError })
    }

    batchesProcessed++
    hasMore = batch.length === BATCH_SIZE

    logger.info(`[${label}] Batch ${batchesProcessed}: ${batch.length} logs processed`)
  }

  return results
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

  const results = await cleanupTier(workspaceIds, retentionDate, label)
  logger.info(
    `[${label}] Result: ${results.deleted} deleted, ${results.deleteFailed} failed out of ${results.total} candidates`
  )

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
