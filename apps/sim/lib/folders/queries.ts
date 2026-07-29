import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { FolderApi, FolderResourceType } from '@/lib/api/contracts/folders'
import type { FolderQueryScope } from '@/hooks/queries/utils/folder-keys'

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
  resourceType: FolderResourceType
): Promise<boolean> {
  let currentParentId: string | null = parentId
  const visited = new Set<string>()

  while (currentParentId) {
    if (visited.has(currentParentId) || currentParentId === folderId) return true
    visited.add(currentParentId)

    const [parent] = await db
      .select({ parentId: folder.parentId })
      .from(folder)
      .where(and(eq(folder.id, currentParentId), eq(folder.resourceType, resourceType)))
      .limit(1)

    currentParentId = parent?.parentId || null
  }

  return false
}

/** Shared by `GET /api/folders` and the sidebar prefetch so the query never drifts between them. */
export async function listFoldersForWorkspace(
  workspaceId: string,
  scope: FolderQueryScope,
  resourceType: FolderResourceType
): Promise<FolderApi[]> {
  const scopeFilter = scope === 'archived' ? isNotNull(folder.deletedAt) : isNull(folder.deletedAt)

  const rows = await db
    .select()
    .from(folder)
    .where(
      and(eq(folder.workspaceId, workspaceId), eq(folder.resourceType, resourceType), scopeFilter)
    )
    .orderBy(asc(folder.sortOrder), asc(folder.createdAt))

  return rows.map(toFolderApi)
}
