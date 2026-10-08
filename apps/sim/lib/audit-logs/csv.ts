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

/** Counts CSV escaping before allocating the encoded row, whose database input is already bounded. */
export function toAuditLogCsvRow(
  row: Awaited<ReturnType<typeof queryAuditLogs>>['data'][number],
  maxBytes: number
): string | undefined {
  const values = [
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
  let bytes = values.length - 1
  for (const value of values) {
    bytes += Buffer.byteLength(value, 'utf8')
    if (bytes > maxBytes) return undefined
    if (/[",\n\r]/.test(value)) {
      bytes += 2
      for (let quote = value.indexOf('"'); quote !== -1; quote = value.indexOf('"', quote + 1)) {
        bytes++
        if (bytes > maxBytes) return undefined
      }
    }
    if (bytes > maxBytes) return undefined
  }
  return toCsvRow(values)
}
