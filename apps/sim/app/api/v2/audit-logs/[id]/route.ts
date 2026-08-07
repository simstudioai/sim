import { db } from '@sim/db'
import { auditLog } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { v2GetAuditLogContract } from '@/lib/api/contracts/v2/audit-logs'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveEnterpriseAuditAccess } from '@/app/api/v1/audit-logs/auth'
import { buildOrgScopeCondition, getOrgWorkspaceIds } from '@/app/api/v1/audit-logs/query'
import { formatV2AuditLogEntry } from '@/app/api/v2/audit-logs/format'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'

export const revalidate = 0

/**
 * GET /api/v2/audit-logs/[id]
 *
 * Returns a single audit log entry scoped to an explicitly selected
 * organization. Audit logs are personal-key-only because a workspace-scoped
 * key must never expand into organization-wide visibility.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2GetAuditLogContract,
  rateLimitEndpoint: 'audit-logs',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    if (rateLimit.keyType !== 'personal') {
      return v2Error('FORBIDDEN', 'Audit logs require a personal API key')
    }

    const authResult = await resolveEnterpriseAuditAccess(userId, input.query.organizationId)
    if (!authResult.success) return v2Error('FORBIDDEN', authResult.message)

    const { id } = input.params
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
  },
})
