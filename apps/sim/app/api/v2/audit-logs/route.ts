import { v2ListAuditLogsContract } from '@/lib/api/contracts/v2/audit-logs'
import {
  cursorRoute,
  cursorScopeKey,
  instantScopePart,
  unorderedScopePart,
} from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listAuditLogs } from '@/lib/audit-logs/application/list-audit-logs'
import { auditLogOperations } from '@/lib/audit-logs/application/operations'
import { formatV2AuditLogEntry } from '@/app/api/v2/audit-logs/format'
import { encodeScopedCursor, readScopedCursor } from '@/app/api/v2/lib/response'

/** Every param that changes which audit entries, in which order, this list returns. */
function auditLogCursorFilters(query: {
  organizationId: string
  includeDeparted: boolean
  action?: string
  resourceType?: string
  resourceId?: string
  workspaceId?: string
  actorEmail?: string
  startDate?: string
  endDate?: string
}) {
  return cursorScopeKey(cursorRoute(v2ListAuditLogsContract), {
    organizationId: query.organizationId,
    includeDeparted: query.includeDeparted,
    action: query.action,
    resourceType: unorderedScopePart(query.resourceType),
    resourceId: query.resourceId,
    workspaceId: query.workspaceId,
    actorEmail: query.actorEmail,
    startDate: instantScopePart(query.startDate),
    endDate: instantScopePart(query.endDate),
  })
}

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
    cursor: readScopedCursor(query.cursor, auditLogCursorFilters(query)),
  }),
  useCase: listAuditLogs,
  present: ({ data, nextCursor }, { query }) => ({
    data: data.map(formatV2AuditLogEntry),
    nextCursor: nextCursor ? encodeScopedCursor(auditLogCursorFilters(query), nextCursor) : null,
  }),
})
