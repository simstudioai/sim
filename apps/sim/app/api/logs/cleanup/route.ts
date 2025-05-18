import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { getS3Client } from '@/lib/uploads/s3-client'
import { db } from '@/db'
import { subscription, user, workflow, workflowLogs } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('LogsCleanup')

const BATCH_SIZE = 2000
const S3_CONFIG = {
  bucket: env.S3_LOGS_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')

    if (!env.CRON_SECRET) {
      return new NextResponse('Configuration error: Cron secret is not set', { status: 500 })
    }

    if (!authHeader || authHeader !== `Bearer ${env.CRON_SECRET}`) {
      logger.warn(`Unauthorized access attempt to logs cleanup endpoint`)
      return new NextResponse('Unauthorized', { status: 401 })
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
      total: 0,
      archived: 0,
      archiveFailed: 0,
      deleted: 0,
      deleteFailed: 0,
    }

    const startTime = Date.now()
    const MAX_BATCHES = 10

    let batchesProcessed = 0
    let hasMoreLogs = true

    while (hasMoreLogs && batchesProcessed < MAX_BATCHES) {
      const oldLogs = await db
        .select({
          id: workflowLogs.id,
          workflowId: workflowLogs.workflowId,
          executionId: workflowLogs.executionId,
          level: workflowLogs.level,
          message: workflowLogs.message,
          duration: workflowLogs.duration,
          trigger: workflowLogs.trigger,
          createdAt: workflowLogs.createdAt,
          metadata: workflowLogs.metadata,
        })
        .from(workflowLogs)
        .where(
          and(
            inArray(workflowLogs.workflowId, workflowIds),
            lt(workflowLogs.createdAt, retentionDate)
          )
        )
        .limit(BATCH_SIZE)

      results.total += oldLogs.length

      for (const log of oldLogs) {
        const today = new Date().toISOString().split('T')[0]

        const logKey = `archived-logs/${today}/${log.id}.json`
        const logData = JSON.stringify(log)

        try {
          await getS3Client().send(
            new PutObjectCommand({
              Bucket: S3_CONFIG.bucket,
              Key: logKey,
              Body: logData,
              ContentType: 'application/json',
              Metadata: {
                logId: String(log.id),
                workflowId: String(log.workflowId),
                archivedAt: new Date().toISOString(),
              },
            })
          )

          results.archived++

          try {
            const deleteResult = await db
              .delete(workflowLogs)
              .where(eq(workflowLogs.id, log.id))
              .returning({ id: workflowLogs.id })

            if (deleteResult.length > 0) {
              results.deleted++
            } else {
              results.deleteFailed++
              logger.warn(`Failed to delete log ${log.id} after archiving: No rows deleted`)
            }
          } catch (deleteError) {
            results.deleteFailed++
            logger.error(`Error deleting log ${log.id} after archiving:`, { deleteError })
          }
        } catch (archiveError) {
          results.archiveFailed++
          logger.error(`Failed to archive log ${log.id}:`, { archiveError })
        }
      }

      batchesProcessed++
      hasMoreLogs = oldLogs.length === BATCH_SIZE

      logger.info(`Processed batch ${batchesProcessed}: ${oldLogs.length} logs`)
    }

    const timeElapsed = (Date.now() - startTime) / 1000
    const reachedLimit = batchesProcessed >= MAX_BATCHES && hasMoreLogs

    return NextResponse.json({
      message: `Processed ${batchesProcessed} batches (${results.total} logs) in ${timeElapsed.toFixed(2)}s${reachedLimit ? ' (batch limit reached)' : ''}`,
      results,
      complete: !hasMoreLogs,
      batchLimitReached: reachedLimit,
    })
  } catch (error) {
    logger.error('Error in log cleanup process:', { error })
    return NextResponse.json({ error: 'Failed to process log cleanup' }, { status: 500 })
  }
}
