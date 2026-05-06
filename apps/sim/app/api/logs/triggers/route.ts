import { db } from '@sim/db'
import { permissions, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { triggersQuerySchema } from '@/lib/api/contracts/logs'
import { searchParamsToObject, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('TriggersAPI')

export const revalidate = 0

/**
 * GET /api/logs/triggers
 *
 * Returns unique trigger types from workflow execution logs
 * Only includes integration triggers (excludes core types: api, manual, webhook, chat, schedule)
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized triggers access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const { searchParams } = new URL(request.url)
    const validation = triggersQuerySchema.safeParse(searchParamsToObject(searchParams))
    if (!validation.success) {
      logger.error(`[${requestId}] Invalid query parameters`, { error: validation.error })
      return validationErrorResponse(validation.error)
    }

    const params = validation.data

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
    logger.error(`[${requestId}] Failed to fetch triggers`, { error: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
