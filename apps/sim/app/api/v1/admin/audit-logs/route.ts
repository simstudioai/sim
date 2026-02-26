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
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
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

const logger = createLogger('AdminAuditLogsAPI')

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  const actionFilter = url.searchParams.get('action')
  const resourceTypeFilter = url.searchParams.get('resourceType')
  const resourceIdFilter = url.searchParams.get('resourceId')
  const workspaceIdFilter = url.searchParams.get('workspaceId')
  const actorIdFilter = url.searchParams.get('actorId')
  const actorEmailFilter = url.searchParams.get('actorEmail')
  const startDateFilter = url.searchParams.get('startDate')
  const endDateFilter = url.searchParams.get('endDate')

  if (startDateFilter && Number.isNaN(Date.parse(startDateFilter))) {
    return badRequestResponse('Invalid startDate format. Use ISO 8601.')
  }
  if (endDateFilter && Number.isNaN(Date.parse(endDateFilter))) {
    return badRequestResponse('Invalid endDate format. Use ISO 8601.')
  }

  try {
    const conditions: SQL<unknown>[] = []

    if (actionFilter) conditions.push(eq(auditLog.action, actionFilter))
    if (resourceTypeFilter) conditions.push(eq(auditLog.resourceType, resourceTypeFilter))
    if (resourceIdFilter) conditions.push(eq(auditLog.resourceId, resourceIdFilter))
    if (workspaceIdFilter) conditions.push(eq(auditLog.workspaceId, workspaceIdFilter))
    if (actorIdFilter) conditions.push(eq(auditLog.actorId, actorIdFilter))
    if (actorEmailFilter) conditions.push(eq(auditLog.actorEmail, actorEmailFilter))
    if (startDateFilter) conditions.push(gte(auditLog.createdAt, new Date(startDateFilter)))
    if (endDateFilter) conditions.push(lte(auditLog.createdAt, new Date(endDateFilter)))

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
