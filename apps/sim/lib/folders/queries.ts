import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { and, type Column, count, eq, isNotNull, isNull } from 'drizzle-orm'
import type { FolderApi, FolderResourceType } from '@/lib/api/contracts/folders'
import { type ListSortOrder, listOrderBy, searchFilter } from '@/lib/api/list-query'
import type { DbOrTx } from '@/lib/db/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { FolderCollectionFullError, FolderCollectionLimitExceededError } from '@/lib/folders/errors'
import { buildFolderPathIndex, type FolderPathIndex, ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { folderResourceLabel } from '@/lib/folders/resource-traits'
import type { FolderQueryScope } from '@/hooks/queries/utils/folder-keys'

export type FolderSortBy = 'position' | 'name' | 'createdAt' | 'updatedAt'

/**
 * Normalizes a `folder` row to the `FolderApi` wire shape (timestamps as ISO strings).
 *
 * Exported because every folder route — list AND mutations — must emit the same shape.
 * `requestJson` validates responses against the contract, so a mutation returning a raw row
 * fails client-side parse after the write has already succeeded.
 */
export function toFolderApi(row: typeof folder.$inferSelect): FolderApi {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

/**
 * Walks up from `parentId` to check whether reparenting `folderId` under it would close a
 * cycle. Scoped to `resourceType` so the walk cannot escape into another resource's tree
 * via an id the caller supplied.
 */
export async function wouldCreateFolderCycle(
  folderId: string,
  parentId: string,
  resourceType: FolderResourceType,
  tx: DbOrTx = db
): Promise<boolean> {
  let currentParentId: string | null = parentId
  const visited = new Set<string>()

  while (currentParentId) {
    if (visited.has(currentParentId) || currentParentId === folderId) return true
    visited.add(currentParentId)

    const [parent] = await tx
      .select({ parentId: folder.parentId })
      .from(folder)
      .where(and(eq(folder.id, currentParentId), eq(folder.resourceType, resourceType)))
      .limit(1)

    currentParentId = parent?.parentId || null
  }

  return false
}

/**
 * Loads an active folder, scoped to both its workspace and its `resourceType`.
 *
 * Every foldered resource needs this before writing its `folderId` column. The FK only
 * proves the folder row exists — not that it belongs to this workspace or to this
 * resource's tree — so without the check a caller could file a knowledge base under
 * another tenant's folder, or under a table folder that the Knowledge page will never
 * render, stranding the row invisibly. The DB trigger `folder_parent_resource_type_match`
 * does not help here: it only guards folder parents.
 *
 * Returns `null` when the folder is missing, archived, in another workspace, or belongs to
 * another resource's tree — a single "not a valid destination" answer.
 */
export async function findActiveFolder(
  folderId: string,
  workspaceId: string,
  resourceType: FolderResourceType
): Promise<typeof folder.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(folder)
    .where(
      and(
        eq(folder.id, folderId),
        eq(folder.workspaceId, workspaceId),
        eq(folder.resourceType, resourceType),
        isNull(folder.deletedAt)
      )
    )
    .limit(1)

  return row ?? null
}

/**
 * Where a restored resource should land: its original folder when that folder is reachable,
 * otherwise the workspace root.
 *
 * `restoringFolderIds` is what makes this safe inside a folder cascade. A `restoreChildren`
 * hook runs BEFORE the folder rows are un-archived (see `restoreFolder` — that ordering is
 * what keeps a partial failure retryable), so a naive "is my folder active?" check sees the
 * folder still archived and dumps every child at the root. Passing the subtree being
 * restored tells the check to treat those folders as already back.
 *
 * Without any set — a single-resource restore out of Recently Deleted — an archived folder
 * still re-roots, because filing a row under a folder no page renders makes it unreachable.
 */
export async function resolveRestoredFolderId(
  folderId: string | null | undefined,
  workspaceId: string | null | undefined,
  resourceType: FolderResourceType,
  restoringFolderIds?: ReadonlySet<string>
): Promise<string | null> {
  if (!folderId || !workspaceId) return null
  if (restoringFolderIds?.has(folderId)) return folderId
  return (await findActiveFolder(folderId, workspaceId, resourceType)) ? folderId : null
}

/**
 * Orderings for the public list's sortable fields, made total over the contract
 * enum by `satisfies`. Each ends in `createdAt` so folders sharing a name or a
 * `sortOrder` still come back in a stable order.
 */
export const FOLDER_SORTS = {
  position: [folder.sortOrder, folder.createdAt],
  name: [folder.name, folder.createdAt],
  createdAt: [folder.createdAt],
  updatedAt: [folder.updatedAt, folder.createdAt],
} satisfies Record<FolderSortBy, readonly Column[]>

interface ListFoldersOptions {
  /** Case-insensitive substring match on the folder name. */
  search?: string
  sortBy?: FolderSortBy
  sortOrder?: ListSortOrder
}

interface ListActiveFolderRowsOptions {
  parentId?: string | null
  search?: string
  sortBy?: Exclude<FolderSortBy, 'position'>
  sortOrder?: ListSortOrder
  maxRows?: number
}

/**
 * Materializes the workspace's active folder tree for one resource type.
 *
 * `maxRows` is opt-in: omitting it reads every active folder row. Callers that
 * pass it get a throw of `FolderCollectionLimitExceededError` rather than a
 * truncated index, because a partial path index resolves real folder paths to
 * `undefined` and re-roots resources at the workspace root. The bound is not a
 * default because folder creation only refuses at the ceiling on the paths that
 * run through the orchestration engine, so a workspace can already hold more
 * rows than the cap and must still be read.
 */
export async function loadActiveFolderPathIndex(
  workspaceId: string,
  resourceType: FolderResourceType,
  tx: DbOrTx = db,
  options?: { maxRows?: number }
): Promise<FolderPathIndex<typeof folder.$inferSelect>> {
  const query = tx
    .select()
    .from(folder)
    .where(
      and(
        eq(folder.workspaceId, workspaceId),
        eq(folder.resourceType, resourceType),
        isNull(folder.deletedAt)
      )
    )
  const rows = options?.maxRows === undefined ? await query : await query.limit(options.maxRows + 1)
  if (options?.maxRows !== undefined && rows.length > options.maxRows) {
    throw new FolderCollectionLimitExceededError('path index', options.maxRows)
  }

  return buildFolderPathIndex(rows)
}

export interface FolderCollectionRoomOptions {
  /**
   * How many folder rows the caller is about to insert. Bulk and recursive
   * creates must pass their real row count: asserting room for one row and then
   * inserting a whole subtree crosses the ceiling just as surely as ignoring it.
   * Defaults to 1, the single-folder create.
   */
  additionalRows?: number
  maxRows?: number
}

/**
 * Refuses a folder create that would push a workspace's active tree past the
 * ceiling the capped readers materialize under.
 *
 * Counts rather than loading the index: the writer only needs the cardinality,
 * and a workspace already over the ceiling must not have its creates fail as a
 * read error. Callers run this inside the folder mutation lock, which is what
 * makes the count authoritative against a concurrent create.
 *
 * One query regardless of how many rows the caller is adding — a bulk writer
 * passes `additionalRows` instead of calling this per row, which would be both
 * O(n) queries and wrong (each call would see room for one more).
 */
export async function assertFolderCollectionHasRoom(
  workspaceId: string,
  resourceType: FolderResourceType,
  tx: DbOrTx = db,
  options: FolderCollectionRoomOptions = {}
): Promise<void> {
  const { additionalRows = 1, maxRows = MAX_FOLDERS_PER_WORKSPACE } = options
  // A copy that creates no folders is not a create; an over-cap workspace must
  // still be allowed to run it.
  if (additionalRows <= 0) return

  const [row] = await tx
    .select({ total: count() })
    .from(folder)
    .where(
      and(
        eq(folder.workspaceId, workspaceId),
        eq(folder.resourceType, resourceType),
        isNull(folder.deletedAt)
      )
    )

  if (Number(row?.total ?? 0) + additionalRows > maxRows) {
    throw new FolderCollectionFullError(folderResourceLabel(resourceType), maxRows)
  }
}

/** Resolves a canonical folder path to its internal id; `/` resolves to the root sentinel. */
export function resolveFolderPathFromIndex(
  index: FolderPathIndex,
  path: string
): string | null | undefined {
  return path === ROOT_FOLDER_PATH ? null : index.idByPath.get(path)
}

/**
 * A list's `folderPath` filter, resolved against the workspace's active folders.
 *
 * `unfiltered` is an omitted param, `folder` names one folder (`null` being the
 * workspace root), and `noMatch` is a path that names no active folder.
 */
export type FolderPathFilter =
  | { kind: 'unfiltered' }
  | { kind: 'folder'; folderId: string | null }
  | { kind: 'noMatch' }

/**
 * Resolves a list's `folderPath` filter, treating a path that names no active
 * folder as a filter nothing satisfies rather than as a missing resource.
 *
 * A list is a collection, and every other filter it accepts answers a value
 * nothing matches with an empty page — `workflowIds` naming no workflow and
 * `model` naming no model both return zero rows. Answering `404 Folder not
 * found` only on the folder filter made one filter's miss a different kind of
 * event from all the others, told a caller its *collection* was missing when it
 * was not, turned a folder deleted mid-walk into a failed pagination loop, and
 * answered whether a path exists on an endpoint that was not asked. The sibling
 * folder lists already answer a non-matching `parentPath` with an empty page, so
 * this is the family's existing behavior applied to the resource lists too.
 *
 * A path that could not name a folder at all is still rejected by the contract,
 * as a 400, before any of this runs. Mutations keep their 404: creating into or
 * moving to a folder that does not exist has no empty-set reading.
 */
export function resolveFolderPathFilter(
  index: FolderPathIndex,
  path: string | undefined
): FolderPathFilter {
  if (path === undefined) return { kind: 'unfiltered' }
  const folderId = resolveFolderPathFromIndex(index, path)
  return folderId === undefined ? { kind: 'noMatch' } : { kind: 'folder', folderId }
}

export async function listActiveFolderRows(
  workspaceId: string,
  resourceType: FolderResourceType,
  options: ListActiveFolderRowsOptions = {},
  tx: DbOrTx = db
): Promise<Array<typeof folder.$inferSelect>> {
  const parentFilter =
    options.parentId === undefined
      ? undefined
      : options.parentId === null
        ? isNull(folder.parentId)
        : eq(folder.parentId, options.parentId)

  const query = tx
    .select()
    .from(folder)
    .where(
      and(
        eq(folder.workspaceId, workspaceId),
        eq(folder.resourceType, resourceType),
        isNull(folder.deletedAt),
        parentFilter,
        searchFilter(folder.name, options.search)
      )
    )
    .orderBy(...listOrderBy(FOLDER_SORTS[options.sortBy ?? 'name'], options.sortOrder ?? 'asc'))
  const rows = options.maxRows === undefined ? await query : await query.limit(options.maxRows + 1)
  if (options.maxRows !== undefined && rows.length > options.maxRows) {
    throw new FolderCollectionLimitExceededError('list', options.maxRows)
  }
  return rows
}

/**
 * Shared by `GET /api/folders`, the public v2 list, and the sidebar prefetch so
 * the query never drifts between them. Search and sort are applied in the
 * query; the in-app callers omit them and keep the default `position` ordering.
 */
export async function listFoldersForWorkspace(
  workspaceId: string,
  scope: FolderQueryScope,
  resourceType: FolderResourceType,
  options?: ListFoldersOptions
): Promise<FolderApi[]> {
  const scopeFilter = scope === 'archived' ? isNotNull(folder.deletedAt) : isNull(folder.deletedAt)
  const sortBy = options?.sortBy ?? 'position'
  const sortOrder = options?.sortOrder ?? 'asc'

  const rows = await db
    .select()
    .from(folder)
    .where(
      and(
        eq(folder.workspaceId, workspaceId),
        eq(folder.resourceType, resourceType),
        scopeFilter,
        searchFilter(folder.name, options?.search)
      )
    )
    .orderBy(...listOrderBy(FOLDER_SORTS[sortBy], sortOrder))

  return rows.map(toFolderApi)
}
