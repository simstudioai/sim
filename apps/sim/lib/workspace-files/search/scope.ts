import { workspaceFiles } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

export type FileSearchOwnerScope =
  | { owner: EditableFileOwner; workspaceId?: never }
  | { owner?: never; workspaceId: string }

/** Old workspace jobs decode explicitly; future or conflicting scopes never fall back. */
export function resolveFileSearchOwner(input: unknown): EditableFileOwner {
  if (!isRecordLike(input)) throw new Error('Invalid file search owner')
  const owner = input.owner
  if (owner === undefined) {
    if (
      typeof input.workspaceId === 'string' &&
      input.workspaceId.trim() === input.workspaceId &&
      input.workspaceId.length > 0 &&
      input.workspaceId.length <= 200
    )
      return { entityType: 'workspace', entityId: input.workspaceId }
  } else if (
    input.workspaceId === undefined &&
    isRecordLike(owner) &&
    (owner.entityType === 'workspace' || owner.entityType === 'project') &&
    typeof owner.entityId === 'string' &&
    owner.entityId.trim() === owner.entityId &&
    owner.entityId.length > 0 &&
    owner.entityId.length <= 200
  )
    return { entityType: owner.entityType, entityId: owner.entityId }
  throw new Error('Invalid file search owner')
}

export function fileSearchOwnerFields(owner: EditableFileOwner) {
  return {
    entityType: owner.entityType,
    entityId: owner.entityId,
    workspaceId: owner.entityType === 'workspace' ? owner.entityId : null,
  }
}

interface SearchOwnerColumns {
  workspaceId: SQLWrapper
  entityType: SQLWrapper
  entityId: SQLWrapper
}

/** Workspace predicates retain the deployed GIN index while Project predicates use the new one. */
export function fileSearchOwnerCondition(table: SearchOwnerColumns, owner: EditableFileOwner): SQL {
  return owner.entityType === 'workspace'
    ? sql`${table.workspaceId} = ${owner.entityId} AND (${table.entityType} IS NULL OR (${table.entityType} = 'workspace' AND ${table.entityId} = ${owner.entityId}))`
    : sql`${table.entityType} = 'project' AND ${table.entityId} = ${owner.entityId} AND ${table.workspaceId} IS NULL`
}

export function searchableFileCondition(owner: EditableFileOwner): SQL {
  const result = and(fileOwnerCondition(owner), eq(workspaceFiles.context, owner.entityType))
  if (!result) throw new OrchestrationError('not_found', 'File owner not found')
  return result
}

/** Input deletion leaves manifest rows intact, so absence can never become valid empty provenance. */
export function currentFileSearchDependencies(buildId: SQLWrapper, owner: EditableFileOwner): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM file_search_dependency dependency
    LEFT JOIN workspace_files input ON input.id = dependency.file_id
      AND input.context = ${owner.entityType}
      AND coalesce(input.entity_type, 'workspace') = ${owner.entityType}
      AND coalesce(input.entity_id, input.workspace_id) = ${owner.entityId}
    WHERE dependency.build_id = ${buildId}
      AND (input.id IS NULL OR input.deleted_at IS NOT NULL OR input.key <> dependency.key
        OR input.content_updated_at <> dependency.source_content_updated_at)
  )`
}
