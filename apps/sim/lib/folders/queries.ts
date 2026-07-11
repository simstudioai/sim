import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { FolderApi, FolderResourceType } from '@/lib/api/contracts/folders'
import type { FolderQueryScope } from '@/hooks/queries/utils/folder-keys'

/** Normalizes timestamp columns to ISO strings to honor the `FolderApi` wire contract. */
function toFolderApi(row: typeof folder.$inferSelect): FolderApi {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

/** Shared by `GET /api/folders` and the sidebar prefetch so the query never drifts between them. */
export async function listFoldersForWorkspace(
  workspaceId: string,
  resourceType: FolderResourceType,
  scope: FolderQueryScope
): Promise<FolderApi[]> {
  const deletedFilter =
    scope === 'archived' ? isNotNull(folder.deletedAt) : isNull(folder.deletedAt)

  const rows = await db
    .select()
    .from(folder)
    .where(
      and(eq(folder.workspaceId, workspaceId), eq(folder.resourceType, resourceType), deletedFilter)
    )
    .orderBy(asc(folder.sortOrder), asc(folder.createdAt))

  return rows.map(toFolderApi)
}
