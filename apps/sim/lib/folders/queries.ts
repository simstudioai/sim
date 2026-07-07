import { db } from '@sim/db'
import { workflowFolder } from '@sim/db/schema'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { FolderApi } from '@/lib/api/contracts/folders'
import type { FolderQueryScope } from '@/hooks/queries/utils/folder-keys'

/** Normalizes timestamp columns to ISO strings to honor the `FolderApi` wire contract. */
function toFolderApi(row: typeof workflowFolder.$inferSelect): FolderApi {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  }
}

/** Shared by `GET /api/folders` and the sidebar prefetch so the query never drifts between them. */
export async function listFoldersForWorkspace(
  workspaceId: string,
  scope: FolderQueryScope
): Promise<FolderApi[]> {
  const archivedFilter =
    scope === 'archived' ? isNotNull(workflowFolder.archivedAt) : isNull(workflowFolder.archivedAt)

  const rows = await db
    .select()
    .from(workflowFolder)
    .where(and(eq(workflowFolder.workspaceId, workspaceId), archivedFilter))
    .orderBy(asc(workflowFolder.sortOrder), asc(workflowFolder.createdAt))

  return rows.map(toFolderApi)
}
