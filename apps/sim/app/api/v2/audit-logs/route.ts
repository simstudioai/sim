import { v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import {
  buildFilterConditions,
  buildOrgScopeCondition,
  getOrgWorkspaceIds,
  queryAuditLogs,
} from '@/app/api/v1/audit-logs/query'
import { formatV2AuditLogEntry } from '@/app/api/v2/audit-logs/format'
import { v2CursorList, v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/audit-logs
 *
 * Lists audit logs scoped to an explicitly selected organization. Audit logs
 * are personal-key-only because a workspace-scoped key must never expand into
 * organization-wide visibility.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2ListAuditLogsContract,
  rateLimitEndpoint: 'audit-logs',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const params = input.query

    if (rateLimit.keyType !== 'personal') {
      return v2Error('FORBIDDEN', 'Audit logs require a personal API key')
    }

    const authResult = await resolveEnterpriseAuditAccess(userId, params.organizationId)
    if (!authResult.success) return v2Error('FORBIDDEN', authResult.message)

    const { organizationId, orgMemberIds } = authResult.context

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
      actorEmail: params.actorEmail,
      startDate: params.startDate,
      endDate: params.endDate,
    })

    const { data, nextCursor } = await queryAuditLogs(
      [scopeCondition, ...filterConditions],
      params.limit,
      params.cursor
    )

    return v2CursorList(data.map(formatV2AuditLogEntry), nextCursor ?? null, { rateLimit })
  },
})
