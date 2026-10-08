import type { queryAuditLogs } from '@/lib/audit-logs/query'
import { formatCsvValue, toCsvRow } from '@/lib/core/utils/csv'

export const AUDIT_LOG_CSV_HEADER = toCsvRow([
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

/** Formats the exported row identically for byte admission and the download response. */
export function toAuditLogCsvRow(row: Awaited<ReturnType<typeof queryAuditLogs>>['data'][number]) {
  return toCsvRow(
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
}
