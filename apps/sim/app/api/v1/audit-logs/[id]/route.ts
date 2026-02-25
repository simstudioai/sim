/**
 * GET /api/v1/audit-logs/[id]
 *
 * Get a single audit log entry by ID, scoped to the authenticated user's organization.
 * Requires enterprise subscription and org admin/owner role.
 *
 * Response: { data: AuditLogEntry, limits: UserLimits }
 */

import { db } from '@sim/db'
import { auditLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'

const logger = createLogger('V1AuditLogDetailAPI')

export const revalidate = 0

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'audit-logs')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { id } = await params

    const authResult = await validateEnterpriseAuditAccess(userId)
    if (!authResult.success) {
      return authResult.response
    }

    const { orgMemberIds } = authResult.context

    const [log] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.id, id),
          inArray(auditLog.actorId, orgMemberIds)
        )
      )
      .limit(1)

    if (!log) {
      return NextResponse.json({ error: 'Audit log not found' }, { status: 404 })
    }

    const limits = await getUserLimits(userId)
    const response = createApiResponse({ data: formatAuditLogEntry(log) }, limits, rateLimit)

    return NextResponse.json(response.body, { headers: response.headers })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Audit log detail fetch error`, { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
