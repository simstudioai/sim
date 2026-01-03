import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, lt, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'

const logger = createLogger('CleanupStaleExecutions')

const STALE_THRESHOLD_MINUTES = 30

export async function GET(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request, 'Stale execution cleanup')
    if (authError) {
      return authError
    }

    logger.info('Starting stale execution cleanup job')

    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000)

    const staleExecutions = await db
      .select({
        id: workflowExecutionLogs.id,
        executionId: workflowExecutionLogs.executionId,
        workflowId: workflowExecutionLogs.workflowId,
        startedAt: workflowExecutionLogs.startedAt,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.status, 'running'),
          lt(workflowExecutionLogs.startedAt, staleThreshold)
        )
      )
      .limit(100)

    logger.info(`Found ${staleExecutions.length} stale executions to clean up`)

    let cleaned = 0
    let failed = 0

    for (const execution of staleExecutions) {
      try {
        const staleDurationMs = Date.now() - new Date(execution.startedAt).getTime()
        const staleDurationMinutes = Math.round(staleDurationMs / 60000)

        await db
          .update(workflowExecutionLogs)
          .set({
            status: 'failed',
            endedAt: new Date(),
            totalDurationMs: staleDurationMs,
            executionData: sql`jsonb_set(
              COALESCE(execution_data, '{}'::jsonb),
              ARRAY['error'],
              to_jsonb(${`Execution terminated: worker timeout or crash after ${staleDurationMinutes} minutes`}::text)
            )`,
          })
          .where(eq(workflowExecutionLogs.id, execution.id))

        logger.info(`Cleaned up stale execution ${execution.executionId}`, {
          workflowId: execution.workflowId,
          staleDurationMinutes,
        })

        cleaned++
      } catch (error) {
        logger.error(`Failed to clean up execution ${execution.executionId}:`, {
          error: error instanceof Error ? error.message : String(error),
        })
        failed++
      }
    }

    logger.info(`Stale execution cleanup completed. Cleaned: ${cleaned}, Failed: ${failed}`)

    return NextResponse.json({
      success: true,
      found: staleExecutions.length,
      cleaned,
      failed,
      thresholdMinutes: STALE_THRESHOLD_MINUTES,
    })
  } catch (error) {
    logger.error('Error in stale execution cleanup job:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
