import {
  AuditAction,
  type AuditLogParams,
  AuditResourceType,
  recordAudit,
  recordAuditBatch,
} from '@sim/audit'
import { createLogger } from '@sim/logger'

const persistenceLogger = createLogger('DurableSecretProvenancePersistence')

export type DurableSecretProvenanceSurface =
  | 'memory'
  | 'table-row'
  | 'knowledge'
  | 'workspace-file'
  | 'tool-result'

export type DurableSecretProvenanceWriteCause =
  | 'source-provenance-unknown'
  | 'invalid-provenance-entries'
  | 'source-hash-unavailable'
  | 'workspace-file-write-unknown'
  | 'workspace-file-write-unrecorded'

export interface DurableSecretProvenanceWriteReport {
  surface: DurableSecretProvenanceSurface
  status: 'unknown' | 'unrecorded'
  cause: DurableSecretProvenanceWriteCause
  recordCount?: number
  workspaceId?: string
  resourceId?: string
}

export type DurableSecretProvenanceRefusalCause =
  | 'knowledge-document-source-unavailable'
  | 'knowledge-result-provenance-unavailable'
  | 'knowledge-chunk-source-unavailable'
  | 'knowledge-workspace-file-source-unavailable'
  | 'workspace-file-provenance-unavailable'
  | 'workspace-file-opaque-secret-content'
  | 'workspace-file-registry-unavailable'
  | 'table-row-provenance-unavailable'
  | 'table-row-opaque-secret-content'
  | 'knowledge-opaque-secret-content'
  | 'content-registry-unavailable'
  | 'tool-result-provenance-unavailable'

export interface DurableSecretProvenanceRefusalReport {
  surface: DurableSecretProvenanceSurface
  cause: DurableSecretProvenanceRefusalCause
  workspaceId?: string
  resourceId?: string
}

/**
 * Reports a non-exact sidecar write without claiming its enclosing transaction committed.
 * Writer defects and refused reads are reported separately. Ordinary legacy records are not faults.
 */
export function reportDurableSecretProvenanceWrite(
  report: DurableSecretProvenanceWriteReport
): void {
  persistenceLogger.error('Writing non-exact durable secret provenance', {
    surface: report.surface,
    status: report.status,
    cause: report.cause,
    ...(report.recordCount !== undefined ? { recordCount: report.recordCount } : {}),
    ...(report.workspaceId ? { workspaceId: report.workspaceId } : {}),
    ...(report.resourceId ? { resourceId: report.resourceId } : {}),
  })
}

/**
 * Reports a durable read refusal without exposing content or secret values. A refusal is policy
 * applied to content that lacks provenance, not a fault, so it is a warning.
 */
export function reportDurableSecretProvenanceRefusal(
  report: DurableSecretProvenanceRefusalReport
): void {
  persistenceLogger.warn('Refusing unavailable durable secret provenance', {
    surface: report.surface,
    cause: report.cause,
    refusedCount: 1,
    ...(report.workspaceId ? { workspaceId: report.workspaceId } : {}),
    ...(report.resourceId ? { resourceId: report.resourceId } : {}),
  })
}

/** Ids one grouped refusal lists, so a page of them stays one line. */
const REFUSAL_RESOURCE_ID_LIMIT = 200

/**
 * Reports the refusals of one read with one line per surface and cause, each
 * carrying the same top-level `surface` and `cause` as a single refusal, its `refusedCount`, and
 * the refused ids, so each id stays paired with its cause.
 */
export function reportDurableSecretProvenanceRefusals(
  reports: readonly DurableSecretProvenanceRefusalReport[]
): void {
  const groups = new Map<string, DurableSecretProvenanceRefusalReport[]>()
  for (const report of reports) {
    const key = JSON.stringify([report.surface, report.cause, report.workspaceId])
    const group = groups.get(key)
    if (group) group.push(report)
    else groups.set(key, [report])
  }
  for (const group of groups.values()) {
    const [first] = group
    if (group.length === 1) {
      reportDurableSecretProvenanceRefusal(first)
      continue
    }
    const resourceIds = group.flatMap((report) => (report.resourceId ? [report.resourceId] : []))
    persistenceLogger.warn('Refusing unavailable durable secret provenance', {
      surface: first.surface,
      cause: first.cause,
      refusedCount: group.length,
      ...(first.workspaceId ? { workspaceId: first.workspaceId } : {}),
      resourceIds: resourceIds.slice(0, REFUSAL_RESOURCE_ID_LIMIT),
      ...(resourceIds.length > REFUSAL_RESOURCE_ID_LIMIT ? { resourceIdsTruncated: true } : {}),
    })
  }
}

export interface DurableSecretProvenanceUnrecordedReport {
  surface: DurableSecretProvenanceSurface
  workspaceId?: string
  organizationId?: string
  resourceId?: string
  recordCount?: number
  actorUserId?: string
}

function unrecordedProvenanceAuditEntry(
  report: DurableSecretProvenanceUnrecordedReport
): AuditLogParams | undefined {
  const metadata = {
    surface: report.surface,
    ...(report.organizationId ? { organizationId: report.organizationId } : {}),
    ...(report.recordCount !== undefined ? { recordCount: report.recordCount } : {}),
  }
  persistenceLogger.warn('Using content without recorded secret provenance', {
    ...metadata,
    ...(report.workspaceId ? { workspaceId: report.workspaceId } : {}),
    ...(report.resourceId ? { resourceId: report.resourceId } : {}),
  })
  if (!report.workspaceId && !report.organizationId) return undefined
  return {
    workspaceId: report.organizationId ? null : report.workspaceId,
    actorId: report.actorUserId ?? null,
    action: AuditAction.SECRET_PROVENANCE_UNRECORDED,
    resourceType: AuditResourceType.SECRET_PROVENANCE,
    ...(report.resourceId ? { resourceId: report.resourceId } : {}),
    description: 'Used content without recorded secret provenance',
    metadata,
  }
}

/** Records accepted content whose producer did not supply provenance, without recording bytes. */
export function reportDurableSecretProvenanceUnrecorded(
  report: DurableSecretProvenanceUnrecordedReport
): void {
  const entry = unrecordedProvenanceAuditEntry(report)
  if (entry) recordAudit(entry)
}

/** Batches tenant-scoped admission events without one pooled database query per source. */
export function reportDurableSecretProvenanceUnrecordedBatch(
  reports: readonly DurableSecretProvenanceUnrecordedReport[]
): void {
  const entries = reports.flatMap((report) => {
    const entry = unrecordedProvenanceAuditEntry(report)
    return entry ? [entry] : []
  })
  if (entries.length > 0) recordAuditBatch(entries)
}
