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
import { buildOrgScopeCondition, getOrgWorkspaceIds } from '@/app/api/v1/audit-logs/query'
import { checkRateLimit } from '@/app/api/v1/middleware'
import { formatV2AuditLogEntry } from '@/app/api/v2/audit-logs/format'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2AuditLogDetailAPI')

export const revalidate = 0

/**
 * GET /api/v2/audit-logs/[id]
 *
 * Returns a single audit log entry scoped to an explicitly selected
 * organization. Audit logs are personal-key-only because a workspace-scoped
 * key must never expand into organization-wide visibility.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)

    try {
      const rateLimit = await checkRateLimit(request, 'audit-logs')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!

      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2GetAuditLogContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      if (rateLimit.keyType !== 'personal') {
        return v2Error('FORBIDDEN', 'Audit logs require a personal API key')
      }

      const authResult = await resolveEnterpriseAuditAccess(
        userId,
        parsed.data.query.organizationId
      )
      if (!authResult.success) return v2Error('FORBIDDEN', authResult.message)

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

      return v2Data(formatV2AuditLogEntry(log), { rateLimit })
    } catch (error) {
      logger.error(`[${requestId}] Audit log detail fetch error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
