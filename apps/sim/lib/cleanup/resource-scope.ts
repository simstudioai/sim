import { and, inArray, isNull } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

export type CleanupOwnerScope = { kind: 'workspace' | 'organization'; ids: string[] }

export function resolveCleanupOwnerScope({
  workspaceIds,
  organizationIds = [],
}: {
  workspaceIds: string[]
  organizationIds?: string[]
}): CleanupOwnerScope {
  if (organizationIds.length > 0 && workspaceIds.length > 0) {
    throw new Error('Cleanup batches must name workspace or organization owners, not both')
  }
  return organizationIds.length > 0
    ? { kind: 'organization', ids: organizationIds }
    : { kind: 'workspace', ids: workspaceIds }
}

export function cleanupOwnerCondition(
  table: { workspaceId: PgColumn; organizationId: PgColumn },
  scope: CleanupOwnerScope,
  ids = scope.ids
) {
  return scope.kind === 'organization'
    ? and(inArray(table.organizationId, ids), isNull(table.workspaceId))
    : and(inArray(table.workspaceId, ids), isNull(table.organizationId))
}
