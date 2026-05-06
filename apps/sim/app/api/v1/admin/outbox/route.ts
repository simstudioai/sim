import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, desc, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { adminV1ListOutboxContract } from '@/lib/api/contracts/v1/admin'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'

const logger = createLogger('AdminOutboxAPI')

export const dynamic = 'force-dynamic'

const invalidOutboxQueryResponse = (message: string) =>
  NextResponse.json({ success: false, error: message }, { status: 400 })

/**
 * GET /api/v1/admin/outbox?status=dead_letter&eventType=...&limit=100
 *
 * Inspect outbox events for operator triage. Primary use: list
 * dead-lettered rows to reconcile Stripe state manually after a
 * permanent handler failure (e.g. Stripe account frozen, subscription
 * already canceled by another path, etc.).
 *
 * Filters:
 *   - `status`: 'pending' | 'processing' | 'completed' | 'dead_letter' (default 'dead_letter')
 *   - `eventType`: exact match on event_type
 *   - `limit`: cap rows returned (default 100, max 500)
 *
 * Response includes aggregate counts by status for quick health read.
 */
export const GET = withRouteHandler(
  withAdminAuth(async (request: NextRequest) => {
    try {
      const parsed = await parseRequest(
        adminV1ListOutboxContract,
        request,
        {},
        {
          validationErrorResponse: (error) =>
            invalidOutboxQueryResponse(getValidationErrorMessage(error, 'Invalid outbox query')),
        }
      )
      if (!parsed.success) return parsed.response

      const { status, eventType, limit } = parsed.data.query

      const whereConditions = [eq(outboxEvent.status, status)]
      if (eventType) {
        whereConditions.push(eq(outboxEvent.eventType, eventType))
      }

      const rows = await db
        .select()
        .from(outboxEvent)
        .where(and(...whereConditions))
        .orderBy(desc(outboxEvent.createdAt))
        .limit(limit)

      // Aggregate counts per (status, eventType) for at-a-glance health.
      const counts = await db
        .select({
          status: outboxEvent.status,
          eventType: outboxEvent.eventType,
          count: sql<number>`count(*)::int`,
        })
        .from(outboxEvent)
        .groupBy(outboxEvent.status, outboxEvent.eventType)

      return NextResponse.json({
        success: true,
        filter: { status, eventType, limit },
        rows,
        counts,
      })
    } catch (error) {
      logger.error('Failed to list outbox events', { error: toError(error).message })
      return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
    }
  })
)
