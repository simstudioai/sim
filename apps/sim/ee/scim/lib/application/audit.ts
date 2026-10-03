import { type AuditActionType, type AuditResourceTypeValue, recordAudit } from '@sim/audit'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'

/** One semantic audit entry a SCIM or admin use case projects from its result. */
export interface ScimAuditEntry {
  action: AuditActionType
  resourceType: AuditResourceTypeValue
  resourceId?: string
  resourceName?: string
  description?: string
  metadata?: Record<string, unknown>
}

/**
 * Records the audit entries a use case projected, with one attribution and one
 * set of contextual metadata applied to every entry. Both wrappers — the
 * directory's and the administrator's — record through here so an audit row
 * looks the same whichever surface produced it.
 */
export function recordScimAuditEntries(params: {
  /** Null for the directory itself, which has no user account. */
  actorId: string | null
  actorName?: string
  entries: readonly ScimAuditEntry[]
  metadata: Record<string, unknown>
  request: OrchestrationRequestContext | undefined
}): void {
  for (const entry of params.entries) {
    recordAudit({
      workspaceId: null,
      actorId: params.actorId,
      ...(params.actorName ? { actorName: params.actorName } : {}),
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      resourceName: entry.resourceName,
      description: entry.description,
      metadata: { ...entry.metadata, ...params.metadata },
      request: params.request,
    })
  }
}
