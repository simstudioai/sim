import { isRecordLike } from '@sim/utils/object'
import { contractUrl } from '@/lib/api/client/request'
import { exportAuditLogsContract } from '@/lib/api/contracts/audit-logs'

/** Trimmed to the most commonly used granularities so the menu fits without scrolling. */
export const AUDIT_TIME_RANGE_OPTIONS = [
  { value: 'All time', label: 'All time' },
  { value: 'Past hour', label: 'Past hour' },
  { value: 'Past 6 hours', label: 'Past 6 hours' },
  { value: 'Past 24 hours', label: 'Past 24 hours' },
  { value: 'Past 3 days', label: 'Past 3 days' },
  { value: 'Past 7 days', label: 'Past 7 days' },
  { value: 'Past 30 days', label: 'Past 30 days' },
  { value: 'Custom range', label: 'Custom range' },
]

export function formatResourceType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function formatAuditAction(action: string): string {
  return action.replace(/[._]/g, ' ')
}

/** An action that removes something reads as destructive in the feed. */
export function isDestructiveAuditAction(action: string): boolean {
  const [, verb] = action.split('.')
  return verb === 'deleted' || verb === 'removed' || verb === 'revoked'
}

export function formatMetadataLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatPrimitiveValue(value: string | number | boolean | null): string {
  if (value === null) return '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toLocaleString()
  return value
}

export type AuditMetadataValue =
  | { kind: 'empty'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'json'; text: string }

function asJson(value: unknown): AuditMetadataValue {
  return { kind: 'json', text: JSON.stringify(value, null, 2) }
}

/** How one metadata value reads: a plain sentence where it can, formatted JSON where it cannot. */
export function describeMetadataValue(value: unknown): AuditMetadataValue {
  if (value == null) return { kind: 'empty', text: '-' }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'text', text: formatPrimitiveValue(value) }
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'empty', text: 'None' }
    if (value.some((item) => typeof item === 'object' && item !== null)) return asJson(value)
    return {
      kind: 'text',
      text: value
        .map((item) => formatPrimitiveValue((item as string | number | boolean | null) ?? null))
        .join(', '),
    }
  }
  if (isRecordLike(value)) {
    const entries = Object.entries(value).filter(([, nested]) => nested !== undefined)
    if (entries.length === 0) return { kind: 'empty', text: 'None' }
    if (entries.some(([, nested]) => Array.isArray(nested) || isRecordLike(nested))) {
      return asJson(value)
    }
    return {
      kind: 'text',
      text: entries
        .map(
          ([key, nested]) =>
            `${formatMetadataLabel(key)}: ${formatPrimitiveValue((nested as string | number | boolean | null) ?? null)}`
        )
        .join(' · '),
    }
  }
  return asJson(value)
}

/** Already rendered as their own labelled rows, so the metadata block would repeat them. */
const HIDDEN_METADATA_KEYS = new Set(['name', 'description'])

export function getAuditMetadataEntries(metadata: unknown): [string, unknown][] {
  if (!isRecordLike(metadata)) return []
  return Object.entries(metadata).filter(([key, value]) => {
    if (value === undefined) return false
    return !HIDDEN_METADATA_KEYS.has(key)
  })
}

/** The export URL for the filters the feed is showing, so a file never holds more than the screen. */
export function auditLogExportUrl(
  organizationId: string,
  filters: {
    search?: string
    resourceType?: string
    workspaceId?: string
    startDate?: string
    endDate?: string
  }
): string {
  return contractUrl(exportAuditLogsContract, {
    query: {
      organizationId,
      search: filters.search || undefined,
      resourceType: filters.resourceType || undefined,
      workspaceId: filters.workspaceId || undefined,
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
    },
  })
}
