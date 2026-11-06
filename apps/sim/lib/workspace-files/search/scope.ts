import { changelogRelease, workflowTest, workspaceFiles } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
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

/**
 * Encodes an owner for an index job. Workspace jobs keep the legacy `{ workspaceId }` shape so a
 * rolled-back worker can still decode them; only Project jobs carry `owner`.
 */
export function fileSearchOwnerScope(owner: EditableFileOwner): FileSearchOwnerScope {
  return owner.entityType === 'workspace' ? { workspaceId: owner.entityId } : { owner }
}

/** Writes canonical owner columns and the legacy workspace key used by deployed workers. */
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

/** Primary search documents are Files resources, never chat uploads or resource-owned bodies. */
export function searchableFileCondition(owner: EditableFileOwner): SQL {
  const result = and(fileOwnerCondition(owner), eq(workspaceFiles.context, owner.entityType))
  if (!result) throw new OrchestrationError('not_found', 'File owner not found')
  return result
}

/**
 * Generated inputs may also be live test or changelog bodies in the same workspace. This
 * predicate establishes storage identity only; delivery must apply the resource owner's policy.
 */
export function fileSearchInputCondition(
  owner: EditableFileOwner,
  input: Record<
    'id' | 'projectId' | 'context' | 'workspaceId' | 'organizationId' | 'chatId',
    SQLWrapper
  > = workspaceFiles
): SQL {
  if (owner.entityType === 'project')
    return sql`${input.projectId} = ${owner.entityId} AND ${input.context} = 'project'
      AND ${input.workspaceId} IS NULL AND ${input.organizationId} IS NULL AND ${input.chatId} IS NULL`
  return sql`${input.workspaceId} = ${owner.entityId}
    AND ${input.projectId} IS NULL AND ${input.organizationId} IS NULL
    AND (${input.context} = 'workspace'
      OR (${input.context} = 'test' AND EXISTS (
        SELECT 1 FROM ${workflowTest} WHERE ${workflowTest.bodyFileId} = ${input.id}
          AND ${workflowTest.workspaceId} = ${owner.entityId} AND ${workflowTest.deletedAt} IS NULL))
      OR (${input.context} = 'changelog' AND EXISTS (
        SELECT 1 FROM ${changelogRelease} WHERE ${changelogRelease.bodyFileId} = ${input.id}
          AND ${changelogRelease.workspaceId} = ${owner.entityId})))`
}

/**
 * Dependency rows, among those `scope` selects, whose input is missing, deleted, or changed since the
 * build compiled it. Input deletion leaves manifest rows intact, so absence can never become valid
 * empty provenance.
 */
function staleFileSearchDependencies(owner: EditableFileOwner, scope: SQL): SQL {
  const input = alias(workspaceFiles, 'input')
  return sql`SELECT dependency.build_id FROM file_search_dependency dependency
    LEFT JOIN workspace_files input ON input.id = dependency.file_id
      AND ${fileSearchInputCondition(owner, input)}
    WHERE ${scope}
      AND (input.id IS NULL OR input.deleted_at IS NOT NULL OR input.key <> dependency.key
        OR input.content_updated_at <> dependency.source_content_updated_at)`
}

/** True when every dependency of `buildId` is still current for `owner`. */
export function currentFileSearchDependencies(buildId: SQLWrapper, owner: EditableFileOwner): SQL {
  return sql`NOT EXISTS (${staleFileSearchDependencies(owner, sql`dependency.build_id = ${buildId}`)})`
}

/**
 * Builds of `owner` with a stale dependency, found from the owner's dependency rows through
 * `file_search_dependency_owner_idx`. A build is stale exactly when
 * {@link currentFileSearchDependencies} is false for it under the same owner: a dependency row
 * carries its build's owner, and a revision only ever points at a build of its own owner.
 */
export function staleFileSearchDependencyBuilds(owner: EditableFileOwner): SQL {
  return staleFileSearchDependencies(
    owner,
    sql`dependency.entity_type = ${owner.entityType} AND dependency.entity_id = ${owner.entityId}`
  )
}
