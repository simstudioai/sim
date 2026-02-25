/**
 * Enterprise audit log response formatting.
 *
 * Defines the shape returned by the enterprise audit log API.
 * Excludes `ipAddress` and `userAgent` for privacy.
 */

import type { auditLog } from '@sim/db/schema'
import type { InferSelectModel } from 'drizzle-orm'

type DbAuditLog = InferSelectModel<typeof auditLog>

export interface EnterpriseAuditLogEntry {
  id: string
  workspaceId: string | null
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  action: string
  resourceType: string
  resourceId: string | null
  resourceName: string | null
  description: string | null
  metadata: unknown
  createdAt: string
}

export function formatAuditLogEntry(log: DbAuditLog): EnterpriseAuditLogEntry {
  return {
    id: log.id,
    workspaceId: log.workspaceId,
    actorId: log.actorId,
    actorName: log.actorName,
    actorEmail: log.actorEmail,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    resourceName: log.resourceName,
    description: log.description,
    metadata: log.metadata,
    createdAt: log.createdAt.toISOString(),
  }
}
