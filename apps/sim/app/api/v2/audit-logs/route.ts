import { v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listAuditLogs } from '@/lib/audit-logs/application/list-audit-logs'
import { auditLogOperations } from '@/lib/audit-logs/application/operations'
import { formatV2AuditLogEntry } from '@/app/api/v2/audit-logs/format'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/audit-logs
 *
 * Lists audit logs scoped to an explicitly selected organization. Audit logs
 * are personal-key-only because a workspace-scoped key must never expand into
 * organization-wide visibility.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListAuditLogsContract,
  auth: v2ApiKeyAuth,
  operation: auditLogOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    organizationId: query.organizationId,
    includeDeparted: query.includeDeparted,
    filters: {
      action: query.action,
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      workspaceId: query.workspaceId,
      actorEmail: query.actorEmail,
      startDate: query.startDate,
      endDate: query.endDate,
    },
    limit: query.limit,
    cursor: query.cursor,
  }),
  useCase: listAuditLogs,
  present: ({ data, nextCursor }) => ({
    data: data.map(formatV2AuditLogEntry),
    nextCursor: nextCursor ?? null,
  }),
})
