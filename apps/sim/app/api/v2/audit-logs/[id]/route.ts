import { db } from '@sim/db'
import { auditLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v2GetAuditLogContract } from '@/lib/api/contracts/v2/audit-logs'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import { buildOrgScopeCondition, getOrgWorkspaceIds } from '@/app/api/v1/audit-logs/query'
import { checkRateLimit } from '@/app/api/v1/middleware'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2AuditLogDetailAPI')

export const revalidate = 0

/**
 * GET /api/v2/audit-logs/[id]
 *
 * Returns a single audit log entry scoped to the authenticated user's
 * organization. Org-scoped (not workspace-scoped). Unlike v1, authorization
 * (`checkRateLimit` → `validateEnterpriseAuditAccess`) runs BEFORE the untrusted
 * param is parsed, fixing the v1 ordering inconsistency. The org-scope predicate
 * is folded into the lookup so a non-org log reads as 404 (existence is not
 * leaked).
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'audit-logs')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const authResult = await resolveEnterpriseAuditAccess(userId)
      if (!authResult.success) return v2Error('FORBIDDEN', authResult.message)

      const parsed = await parseRequest(v2GetAuditLogContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
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

      if (!log) return v2Error('NOT_FOUND', 'Audit log not found')

      return v2Data(formatAuditLogEntry(log), { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Audit log detail fetch error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
