import { db } from '@sim/db'
import { permissions, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('TriggersAPI')

export const revalidate = 0

const QueryParamsSchema = z.object({
  workspaceId: z.string(),
})

/**
 * GET /api/logs/triggers
 *
 * Returns unique trigger types from workflow execution logs
 * Only includes integration triggers (excludes core types: api, manual, webhook, chat, schedule)
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized triggers access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    try {
      const { searchParams } = new URL(request.url)
      const params = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))

      const triggers = await db
        .selectDistinct({
          trigger: workflowExecutionLogs.trigger,
        })
        .from(workflowExecutionLogs)
        .innerJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workflowExecutionLogs.workspaceId),
            eq(permissions.userId, userId)
          )
        )
        .where(
          and(
            eq(workflowExecutionLogs.workspaceId, params.workspaceId),
            isNotNull(workflowExecutionLogs.trigger),
            sql`${workflowExecutionLogs.trigger} NOT IN ('api', 'manual', 'webhook', 'chat', 'schedule')`
          )
        )

      const triggerValues = triggers
        .map((row) => row.trigger)
        .filter((t): t is string => Boolean(t))
        .sort()

      return NextResponse.json({
        triggers: triggerValues,
        count: triggerValues.length,
      })
    } catch (err) {
      if (err instanceof z.ZodError) {
        logger.error(`[${requestId}] Invalid query parameters`, { error: err })
        return NextResponse.json(
          { error: 'Invalid query parameters', details: err.errors },
          { status: 400 }
        )
      }

      throw err
    }
  } catch (err) {
    logger.error(`[${requestId}] Failed to fetch triggers`, { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
