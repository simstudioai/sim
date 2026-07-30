import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import {
  buildFilterConditions,
  buildOrgScopeCondition,
  getOrgWorkspaceIds,
  queryAuditLogs,
} from '@/app/api/v1/audit-logs/query'
import { checkRateLimit } from '@/app/api/v1/middleware'
import {
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2AuditLogsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/audit-logs
 *
 * Lists audit logs scoped to the authenticated user's organization. Org-scoped
 * (not workspace-scoped): `resolveWorkspaceAccess` is intentionally NOT used —
 * access is gated by enterprise org admin/owner membership. Auth ordering
 * matches v1: `checkRateLimit` → `validateEnterpriseAuditAccess` run before the
 * untrusted query is parsed.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'audit-logs')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const authResult = await resolveEnterpriseAuditAccess(userId)
    if (!authResult.success) return v2Error('FORBIDDEN', authResult.message)

    const { organizationId, orgMemberIds } = authResult.context

    const parsed = await parseRequest(
      v2ListAuditLogsContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const params = parsed.data.query

    if (params.actorId && !orgMemberIds.includes(params.actorId)) {
      return v2Error('BAD_REQUEST', 'actorId is not a member of your organization')
    }

    const orgWorkspaceIds = await getOrgWorkspaceIds(organizationId)

    if (params.workspaceId && !orgWorkspaceIds.includes(params.workspaceId)) {
      return v2Error('BAD_REQUEST', 'workspaceId does not belong to your organization')
    }

    const scopeCondition = buildOrgScopeCondition({
      organizationId,
      orgWorkspaceIds,
      orgMemberIds,
      includeDeparted: params.includeDeparted,
    })
    const filterConditions = buildFilterConditions({
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      startDate: params.startDate,
      endDate: params.endDate,
    })

    const { data, nextCursor } = await queryAuditLogs(
      [scopeCondition, ...filterConditions],
      params.limit,
      params.cursor
    )

    return v2CursorList(data.map(formatAuditLogEntry), nextCursor ?? null, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Audit logs fetch error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
