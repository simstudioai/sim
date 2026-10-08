import { exportAuditLogsContract } from '@/lib/api/contracts/audit-logs'
import {
  defineInternalBinaryRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { exportAuditLogs } from '@/lib/audit-logs/application/export-audit-logs'
import { auditLogOperations } from '@/lib/audit-logs/application/operations'
import { formatCsvValue, toCsvRow } from '@/lib/core/utils/csv'

const CSV_HEADER = toCsvRow([
  'Date',
  'Action',
  'Resource Type',
  'Resource Name',
  'Actor',
  'Description',
  'Event ID',
  'Workspace ID',
  'Resource ID',
  'Actor ID',
  'IP Address',
  'User Agent',
  'Surface',
  'Metadata',
])

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
  present: ({ rows, truncated }) => ({
    body: [
      CSV_HEADER,
      ...rows.map((row) =>
        toCsvRow(
          [
            row.createdAt,
            row.action,
            row.resourceType,
            row.resourceName,
            row.actorEmail || row.actorName || 'System',
            row.description,
            row.id,
            row.workspaceId,
            row.resourceId,
            row.actorId,
            row.ipAddress,
            row.userAgent,
            row.surface,
            row.metadata,
          ].map((value) => formatCsvValue(value))
        )
      ),
    ].join('\n'),
    contentType: 'text/csv; charset=utf-8',
    contentDisposition: `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    headers: { 'Cache-Control': 'no-store', 'X-Export-Truncated': truncated ? '1' : '0' },
  }),
})
