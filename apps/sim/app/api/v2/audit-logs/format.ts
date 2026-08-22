import type { auditLog } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import type { InferSelectModel } from 'drizzle-orm'

type DbAuditLog = Pick<
  InferSelectModel<typeof auditLog>,
  | 'id'
  | 'workspaceId'
  | 'actorName'
  | 'actorEmail'
  | 'action'
  | 'resourceType'
  | 'resourceId'
  | 'resourceName'
  | 'description'
  | 'metadata'
  | 'createdAt'
>

const INTERNAL_FOLDER_ID_KEYS = new Set([
  'folderId',
  'folderIds',
  'parentId',
  'tableImportFolderId',
  'targetFolderId',
])

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata)
  if (!isRecordLike(value)) return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (INTERNAL_FOLDER_ID_KEYS.has(key)) continue
    sanitized[key] = sanitizeMetadata(child)
  }
  return sanitized
}

/** Removes database folder identifiers from the public v2 audit projection. */
export function formatV2AuditLogEntry(log: DbAuditLog) {
  return {
    id: log.id,
    workspaceId: log.workspaceId,
    actorName: log.actorName,
    actorEmail: log.actorEmail,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceType === 'folder' ? null : log.resourceId,
    resourceName: log.resourceName,
    description: log.description,
    metadata: sanitizeMetadata(log.metadata),
    createdAt: log.createdAt.toISOString(),
  }
}
