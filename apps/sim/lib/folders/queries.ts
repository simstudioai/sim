import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { and, type Column, eq, isNotNull, isNull } from 'drizzle-orm'
import type { FolderApi, FolderResourceType } from '@/lib/api/contracts/folders'
import type { V2SortOrder } from '@/lib/api/contracts/v2/shared'
import { listOrderBy, searchFilter } from '@/lib/api/list-query'
import type { DbOrTx } from '@/lib/db/types'
import { buildFolderPathIndex, type FolderPathIndex, ROOT_FOLDER_PATH } from '@/lib/folders/paths'
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
 * A folder in a workspace's tree regardless of archive state.
 *
 * {@link findActiveFolder} answers "is this a valid destination"; this answers "does this row
 * exist here at all". Delete needs the second question — `deleteFolder` reuses an already
 * archived folder's own `deletedAt` so a cascade that failed partway can be retried, and
 * filtering archived rows out would strand those stragglers.
 */
export async function findFolderInWorkspace(
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
        eq(folder.resourceType, resourceType)
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
const FOLDER_SORTS = {
  position: [folder.sortOrder, folder.createdAt],
  name: [folder.name, folder.createdAt],
  createdAt: [folder.createdAt],
  updatedAt: [folder.updatedAt, folder.createdAt],
} satisfies Record<FolderSortBy, readonly Column[]>

interface ListFoldersOptions {
  /** Case-insensitive substring match on the folder name. */
  search?: string
  sortBy?: FolderSortBy
  sortOrder?: V2SortOrder
}

interface ListActiveFolderRowsOptions {
  parentId?: string | null
  search?: string
  sortBy?: Exclude<FolderSortBy, 'position'>
  sortOrder?: V2SortOrder
}

export async function loadActiveFolderPathIndex(
  workspaceId: string,
  resourceType: FolderResourceType,
  tx: DbOrTx = db
): Promise<FolderPathIndex<typeof folder.$inferSelect>> {
  const rows = await tx
    .select()
    .from(folder)
    .where(
      and(
        eq(folder.workspaceId, workspaceId),
        eq(folder.resourceType, resourceType),
        isNull(folder.deletedAt)
      )
    )

  return buildFolderPathIndex(rows)
}

/** Resolves a canonical folder path to its internal id; `/` resolves to the root sentinel. */
export function resolveFolderPathFromIndex(
  index: FolderPathIndex,
  path: string
): string | null | undefined {
  return path === ROOT_FOLDER_PATH ? null : index.idByPath.get(path)
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

  return tx
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
