import { listAuditLogsContract } from '@/lib/api/contracts/audit-logs'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { formatAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import { listAuditLogs } from '@/ee/audit-logs/lib/application/list-audit-logs'
import { auditLogOperations } from '@/ee/audit-logs/lib/application/operations'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: listAuditLogsContract,
  auth: internalSessionAuth,
  operation: auditLogOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Existing authenticated audit-log settings read has no request-rate policy',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    organizationId: query.organizationId,
    includeDeparted: query.includeDeparted,
    filters: {
      search: query.search,
      action: query.action,
      resourceType: query.resourceType,
      actorId: query.actorId,
      workspaceId: query.workspaceId,
      startDate: query.startDate,
      endDate: query.endDate,
    },
    limit: query.limit,
    cursor: query.cursor,
  }),
  useCase: listAuditLogs,
  present: ({ data, nextCursor }) => ({
    success: true,
    data: data.map(formatAuditLogEntry),
    nextCursor,
  }),
})
