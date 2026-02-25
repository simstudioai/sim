/**
 * GET /api/v1/admin/audit-logs/[id]
 *
 * Get a single audit log entry by ID.
 *
 * Response: AdminSingleResponse<AdminAuditLog>
 */

import { db } from '@sim/db'
import { auditLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { toAdminAuditLog } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminAuditLogDetailAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id } = await context.params

  try {
    const [log] = await db.select().from(auditLog).where(eq(auditLog.id, id)).limit(1)

    if (!log) {
      return notFoundResponse('AuditLog')
    }

    logger.info(`Admin API: Retrieved audit log ${id}`)

    return singleResponse(toAdminAuditLog(log))
  } catch (error) {
    logger.error('Admin API: Failed to get audit log', { error, id })
    return internalErrorResponse('Failed to get audit log')
  }
})
