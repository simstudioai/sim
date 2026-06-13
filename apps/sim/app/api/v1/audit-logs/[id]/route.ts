/**
 * GET /api/v1/audit-logs/[id]
 *
 * Get a single audit log entry by ID, scoped to the authenticated user's organization.
 * Requires enterprise subscription and org admin/owner role.
 *
 * Scope is the organization boundary: logs within org-attached workspaces and
 * org-level events (including those from departed members or system actions
 * with null actorId).
 *
 * Response: { data: AuditLogEntry, limits: UserLimits }
 */

import { db } from '@sim/db'
import { auditLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v1GetAuditLogContract } from '@/lib/api/contracts/v1/audit-logs'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import { buildOrgScopeCondition, getOrgWorkspaceIds } from '@/app/api/v1/audit-logs/query'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'

const logger = createLogger('V1AuditLogDetailAPI')

export const revalidate = 0

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'audit-logs')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v1GetAuditLogContract, request, context, {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Invalid audit log ID' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const authResult = await validateEnterpriseAuditAccess(userId)
      if (!authResult.success) {
        return authResult.response
      }

      const { organizationId, orgMemberIds } = authResult.context

      const orgWorkspaceIds = await getOrgWorkspaceIds(organizationId)
      const scopeCondition = buildOrgScopeCondition({
        organizationId,
        orgWorkspaceIds,
        orgMemberIds,
        includeDeparted: true,
      })

      const [log] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.id, id), scopeCondition))
        .limit(1)

      if (!log) {
        return NextResponse.json({ error: 'Audit log not found' }, { status: 404 })
      }

      const limits = await getUserLimits(userId)
      const response = createApiResponse({ data: formatAuditLogEntry(log) }, limits, rateLimit)

      return NextResponse.json(response.body, { headers: response.headers })
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unknown error')
      logger.error(`[${requestId}] Audit log detail fetch error`, { error: message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
