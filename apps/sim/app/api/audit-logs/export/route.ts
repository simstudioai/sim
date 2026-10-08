import { exportAuditLogsContract } from '@/lib/api/contracts/audit-logs'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { exportAuditLogs } from '@/lib/audit-logs/application/export-audit-logs'
import { auditLogOperations } from '@/lib/audit-logs/application/operations'

export const GET = defineInternalBinaryRoute({
  contract: exportAuditLogsContract,
  auth: internalSessionAuth,
  operation: auditLogOperations.export,
  rateLimit: internalRateLimits.none({ reason: 'Organization administrator CSV download' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => {
    const { organizationId, includeDeparted, ...filters } = query
    return { organizationId, includeDeparted, filters }
  },
  useCase: exportAuditLogs,
  present: ({ csv, truncated }) => ({
    body: csv,
    contentType: 'text/csv; charset=utf-8',
    contentDisposition: `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    headers: { 'Cache-Control': 'no-store', 'X-Export-Truncated': truncated ? '1' : '0' },
  }),
})
