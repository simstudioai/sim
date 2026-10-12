import {
  AuditAction,
  type AuditLogParams,
  AuditResourceType,
  recordAudit,
  recordAuditBatch,
} from '@sim/audit'
import { createLogger } from '@sim/logger'

const persistenceLogger = createLogger('DurableSecretProvenancePersistence')

export type DurableSecretProvenanceSurface = 'memory' | 'table-row' | 'knowledge' | 'workspace-file'

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

/** Reports a durable read refusal without exposing content or secret values. */
export function reportDurableSecretProvenanceRefusal(
  report: DurableSecretProvenanceRefusalReport
): void {
  persistenceLogger.error('Refusing unavailable durable secret provenance', {
    surface: report.surface,
    cause: report.cause,
    ...(report.workspaceId ? { workspaceId: report.workspaceId } : {}),
    ...(report.resourceId ? { resourceId: report.resourceId } : {}),
  })
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
