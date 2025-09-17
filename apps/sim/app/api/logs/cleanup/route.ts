import { PutObjectCommand } from '@aws-sdk/client-s3'
// Dynamic import for S3 client to avoid client-side bundling
import { db } from '@sim/db'
import { subscription, user, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { deleteFile, isUsingCloudStorage } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

const logger = createLogger('LogsCleanupAPI')

const BATCH_SIZE = 2000
const S3_CONFIG = {
  bucket: env.S3_LOGS_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export async function GET(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request, 'logs cleanup')
    if (authError) {
      return authError
    }

    if (!S3_CONFIG.bucket || !S3_CONFIG.region) {
      return new NextResponse('Configuration error: S3 bucket or region not set', { status: 500 })
    }

    const retentionDate = new Date()
    retentionDate.setDate(retentionDate.getDate() - Number(env.FREE_PLAN_LOG_RETENTION_DAYS || '7'))

    const freeUsers = await db
      .select({ userId: user.id })
      .from(user)
      .leftJoin(
        subscription,
        sql`${user.id} = ${subscription.referenceId} AND ${subscription.status} = 'active' AND ${subscription.plan} IN ('pro', 'team', 'enterprise')`
      )
      .where(sql`${subscription.id} IS NULL`)

    if (freeUsers.length === 0) {
      logger.info('No free users found for log cleanup')
      return NextResponse.json({ message: 'No free users found for cleanup' })
    }

    const freeUserIds = freeUsers.map((u) => u.userId)

    const workflowsQuery = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(inArray(workflow.userId, freeUserIds))

    if (workflowsQuery.length === 0) {
      logger.info('No workflows found for free users')
      return NextResponse.json({ message: 'No workflows found for cleanup' })
    }

    const workflowIds = workflowsQuery.map((w) => w.id)

    const results = {
      enhancedLogs: {
        total: 0,
        archived: 0,
        archiveFailed: 0,
        deleted: 0,
        deleteFailed: 0,
      },
      files: {
        total: 0,
        deleted: 0,
        deleteFailed: 0,
      },
      snapshots: {
        cleaned: 0,
        cleanupFailed: 0,
      },
    }

    const startTime = Date.now()
    const MAX_BATCHES = 10

    // Process enhanced logging cleanup
    let batchesProcessed = 0
    let hasMoreLogs = true

    logger.info(`Starting enhanced logs cleanup for ${workflowIds.length} workflows`)

    while (hasMoreLogs && batchesProcessed < MAX_BATCHES) {
      // Query enhanced execution logs that need cleanup
      const oldEnhancedLogs = await db
        .select({
          id: workflowExecutionLogs.id,
          workflowId: workflowExecutionLogs.workflowId,
          executionId: workflowExecutionLogs.executionId,
          stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
          level: workflowExecutionLogs.level,
          trigger: workflowExecutionLogs.trigger,
          startedAt: workflowExecutionLogs.startedAt,
          endedAt: workflowExecutionLogs.endedAt,
          totalDurationMs: workflowExecutionLogs.totalDurationMs,
          executionData: workflowExecutionLogs.executionData,
          cost: workflowExecutionLogs.cost,
          files: workflowExecutionLogs.files,
          createdAt: workflowExecutionLogs.createdAt,
        })
        .from(workflowExecutionLogs)
        .where(
          and(
            inArray(workflowExecutionLogs.workflowId, workflowIds),
            lt(workflowExecutionLogs.createdAt, retentionDate)
          )
        )
        .limit(BATCH_SIZE)

      results.enhancedLogs.total += oldEnhancedLogs.length

      for (const log of oldEnhancedLogs) {
        const today = new Date().toISOString().split('T')[0]

        // Archive enhanced log with more detailed structure
        const enhancedLogKey = `archived-enhanced-logs/${today}/${log.id}.json`
        const enhancedLogData = JSON.stringify({
          ...log,
          archivedAt: new Date().toISOString(),
          logType: 'enhanced',
        })

        try {
          const { getS3Client } = await import('@/lib/uploads/s3/s3-client')
          await getS3Client().send(
            new PutObjectCommand({
              Bucket: S3_CONFIG.bucket,
              Key: enhancedLogKey,
              Body: enhancedLogData,
              ContentType: 'application/json',
              Metadata: {
                logId: String(log.id),
                workflowId: String(log.workflowId),
                executionId: String(log.executionId),
                logType: 'enhanced',
                archivedAt: new Date().toISOString(),
              },
            })
          )

          results.enhancedLogs.archived++

          // Clean up associated files if using cloud storage
          if (isUsingCloudStorage() && log.files && Array.isArray(log.files)) {
            for (const file of log.files) {
              if (file && typeof file === 'object' && file.key) {
                results.files.total++
                try {
                  await deleteFile(file.key)
                  results.files.deleted++
                  logger.info(`Deleted file: ${file.key}`)
                } catch (fileError) {
                  results.files.deleteFailed++
                  logger.error(`Failed to delete file ${file.key}:`, { fileError })
                }
              }
            }
          }

          try {
            // Delete enhanced log
            const deleteResult = await db
              .delete(workflowExecutionLogs)
              .where(eq(workflowExecutionLogs.id, log.id))
              .returning({ id: workflowExecutionLogs.id })

            if (deleteResult.length > 0) {
              results.enhancedLogs.deleted++
            } else {
              results.enhancedLogs.deleteFailed++
              logger.warn(
                `Failed to delete enhanced log ${log.id} after archiving: No rows deleted`
              )
            }
          } catch (deleteError) {
            results.enhancedLogs.deleteFailed++
            logger.error(`Error deleting enhanced log ${log.id} after archiving:`, { deleteError })
          }
        } catch (archiveError) {
          results.enhancedLogs.archiveFailed++
          logger.error(`Failed to archive enhanced log ${log.id}:`, { archiveError })
        }
      }

      batchesProcessed++
      hasMoreLogs = oldEnhancedLogs.length === BATCH_SIZE

      logger.info(
        `Processed enhanced logs batch ${batchesProcessed}: ${oldEnhancedLogs.length} logs`
      )
    }

    // Cleanup orphaned snapshots
    try {
      const snapshotRetentionDays = Number(env.FREE_PLAN_LOG_RETENTION_DAYS || '7') + 1 // Keep snapshots 1 day longer
      const cleanedSnapshots = await snapshotService.cleanupOrphanedSnapshots(snapshotRetentionDays)
      results.snapshots.cleaned = cleanedSnapshots
      logger.info(`Cleaned up ${cleanedSnapshots} orphaned snapshots`)
    } catch (snapshotError) {
      results.snapshots.cleanupFailed = 1
      logger.error('Error cleaning up orphaned snapshots:', { snapshotError })
    }

    const timeElapsed = (Date.now() - startTime) / 1000
    const reachedLimit = batchesProcessed >= MAX_BATCHES && hasMoreLogs

    return NextResponse.json({
      message: `Processed ${batchesProcessed} enhanced log batches (${results.enhancedLogs.total} logs, ${results.files.total} files) in ${timeElapsed.toFixed(2)}s${reachedLimit ? ' (batch limit reached)' : ''}`,
      results,
      complete: !hasMoreLogs,
      batchLimitReached: reachedLimit,
    })
  } catch (error) {
    logger.error('Error in log cleanup process:', { error })
    return NextResponse.json({ error: 'Failed to process log cleanup' }, { status: 500 })
  }
}
