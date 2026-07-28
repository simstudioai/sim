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

/** Shared by `GET /api/folders` and the sidebar prefetch so the query never drifts between them. */
export async function listFoldersForWorkspace(
  workspaceId: string,
  scope: FolderQueryScope,
  resourceType: FolderResourceType = 'workflow'
): Promise<FolderApi[]> {
  // Only workflow folders have been cut over to the `folder` table. File folders are still
  // written to `workspace_file_folders` by `uploads/contexts/workspace`, so the `file` rows
  // the migration backfilled here are a frozen snapshot — serving them would return stale
  // data. `knowledge_base` and `table` folders have no writer at all yet. Returning empty is
  // correct for those until each type's writers move over.
  if (resourceType !== 'workflow') return []

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
