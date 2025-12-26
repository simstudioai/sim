/**
 * GET /api/v1/admin/subscriptions
 *
 * List all subscriptions with pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *   - plan: string (optional) - Filter by plan (free, pro, team, enterprise)
 *   - status: string (optional) - Filter by status (active, canceled, etc.)
 *
 * Response: AdminListResponse<AdminSubscription>
 */

import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, type SQL } from 'drizzle-orm'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import { internalErrorResponse, listResponse } from '@/app/api/v1/admin/responses'
import {
  type AdminSubscription,
  createPaginationMeta,
  parsePaginationParams,
  toAdminSubscription,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminSubscriptionsAPI')

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)
  const planFilter = url.searchParams.get('plan')
  const statusFilter = url.searchParams.get('status')

  try {
    const conditions: SQL<unknown>[] = []
    if (planFilter) {
      conditions.push(eq(subscription.plan, planFilter))
    }
    if (statusFilter) {
      conditions.push(eq(subscription.status, statusFilter))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [countResult, subscriptions] = await Promise.all([
      db.select({ total: count() }).from(subscription).where(whereClause),
      db
        .select()
        .from(subscription)
        .where(whereClause)
        .orderBy(subscription.plan)
        .limit(limit)
        .offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminSubscription[] = subscriptions.map(toAdminSubscription)
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} subscriptions (total: ${total})`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list subscriptions', { error })
    return internalErrorResponse('Failed to list subscriptions')
  }
})
