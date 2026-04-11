/**
 * GET /api/v1/admin/audit-logs
 *
 * List all audit logs with pagination and filtering.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *   - action: string (optional) - Filter by action (e.g., "workflow.created")
 *   - resourceType: string (optional) - Filter by resource type (e.g., "workflow")
 *   - resourceId: string (optional) - Filter by resource ID
 *   - workspaceId: string (optional) - Filter by workspace ID
 *   - actorId: string (optional) - Filter by actor user ID
 *   - actorEmail: string (optional) - Filter by actor email
 *   - startDate: string (optional) - ISO 8601 date, filter createdAt >= startDate
 *   - endDate: string (optional) - ISO 8601 date, filter createdAt <= endDate
 *
 * Response: AdminListResponse<AdminAuditLog>
 */

import { db } from '@sim/db'
import { auditLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, desc } from 'drizzle-orm'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  listResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminAuditLog,
  createPaginationMeta,
  parsePaginationParams,
  toAdminAuditLog,
} from '@/app/api/v1/admin/types'
import { buildFilterConditions } from '@/app/api/v1/audit-logs/query'

const logger = createLogger('AdminAuditLogsAPI')

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  const startDate = url.searchParams.get('startDate') || undefined
  const endDate = url.searchParams.get('endDate') || undefined

  if (startDate && Number.isNaN(Date.parse(startDate))) {
    return badRequestResponse('Invalid startDate format. Use ISO 8601.')
  }
  if (endDate && Number.isNaN(Date.parse(endDate))) {
    return badRequestResponse('Invalid endDate format. Use ISO 8601.')
  }

  try {
    const conditions = buildFilterConditions({
      action: url.searchParams.get('action') || undefined,
      resourceType: url.searchParams.get('resourceType') || undefined,
      resourceId: url.searchParams.get('resourceId') || undefined,
      workspaceId: url.searchParams.get('workspaceId') || undefined,
      actorId: url.searchParams.get('actorId') || undefined,
      actorEmail: url.searchParams.get('actorEmail') || undefined,
      startDate,
      endDate,
    })

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [countResult, logs] = await Promise.all([
      db.select({ total: count() }).from(auditLog).where(whereClause),
      db
        .select()
        .from(auditLog)
        .where(whereClause)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminAuditLog[] = logs.map(toAdminAuditLog)
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} audit logs (total: ${total})`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list audit logs', { error })
    return internalErrorResponse('Failed to list audit logs')
  }
})
