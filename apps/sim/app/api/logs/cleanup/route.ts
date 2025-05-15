import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { subscription, user, workflowLogs } from '@/db/schema'

const logger = createLogger('LogsCleanup')

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')

    if (!process.env.CRON_SECRET) {
      return new NextResponse('Configuration error: Cron secret is not set', { status: 500 })
    }

    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      logger.warn(`Unauthorized access attempt to logs cleanup endpoint`)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const retentionDate = new Date()
    retentionDate.setDate(
      retentionDate.getDate() - Number(process.env.FREE_PLAN_LOG_RETENTION_DAYS)
    )

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
    logger.info(`Found ${freeUserIds.length} free users for log cleanup`)

    const freeUserWorkflows = await db
      .select({ workflowId: workflowLogs.workflowId })
      .from(workflowLogs)
      .innerJoin(
        sql`workflow`,
        sql`${workflowLogs.workflowId} = workflow.id AND workflow.user_id IN (${sql.join(freeUserIds)})`
      )
      .groupBy(workflowLogs.workflowId)

    if (freeUserWorkflows.length === 0) {
      logger.info('No free user workflows found for log cleanup')
      return NextResponse.json({ message: 'No logs to clean up' })
    }

    const workflowIds = freeUserWorkflows.map((w) => w.workflowId)

    const result = await db
      .delete(workflowLogs)
      .where(
        sql`${workflowLogs.workflowId} IN (${sql.join(workflowIds)}) AND ${workflowLogs.createdAt} < ${retentionDate}`
      )
      .returning({ id: workflowLogs.id })

    logger.info(`Successfully cleaned up ${result.length} logs for free users`)

    return NextResponse.json({
      message: `Successfully cleaned up ${result.length} logs for free users`,
      deletedCount: result.length,
    })
  } catch (error) {
    logger.error('Error cleaning up logs:', { error })
    return NextResponse.json({ error: 'Failed to clean up logs' }, { status: 500 })
  }
}
