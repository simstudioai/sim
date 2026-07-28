import { db } from '@sim/db'
import { workflowFolder } from '@sim/db/schema'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { FolderApi, FolderResourceType } from '@/lib/api/contracts/folders'
import type { FolderQueryScope } from '@/hooks/queries/utils/folder-keys'

/**
 * Adapts a legacy `workflow_folder` row to the generic `FolderApi` wire shape.
 *
 * The wire contract has already moved to the generic vocabulary (`resourceType`,
 * `deletedAt`) while the read path still targets `workflow_folder` — the writers have not
 * been cut over to the `folder` table yet. Keeping the adapter here means the cutover is a
 * one-file change to the query below, with no contract or consumer churn.
 *
 * `color`/`isExpanded` are intentionally not surfaced: neither had a consumer, and
 * expansion state is client-only (see `stores/folders/types.ts`).
 *
 * Exported because every folder route — list AND mutations — must emit the same shape.
 * `requestJson` validates responses against the contract, so a mutation returning a raw
 * row fails client-side parse after the write has already succeeded.
 */
export function toFolderApi(row: typeof workflowFolder.$inferSelect): FolderApi {
  return {
    id: row.id,
    resourceType: 'workflow',
    name: row.name,
    userId: row.userId,
    workspaceId: row.workspaceId,
    parentId: row.parentId,
    locked: row.locked,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  }
}

/** Shared by `GET /api/folders` and the sidebar prefetch so the query never drifts between them. */
export async function listFoldersForWorkspace(
  workspaceId: string,
  scope: FolderQueryScope,
  resourceType: FolderResourceType = 'workflow'
): Promise<FolderApi[]> {
  // Only workflow folders exist in the legacy table; the other resource types have no rows
  // until the `folder` cutover lands, so they correctly return empty rather than erroring.
  if (resourceType !== 'workflow') return []

  const scopeFilter =
    scope === 'archived' ? isNotNull(workflowFolder.archivedAt) : isNull(workflowFolder.archivedAt)

  const rows = await db
    .select()
    .from(workflowFolder)
    .where(and(eq(workflowFolder.workspaceId, workspaceId), scopeFilter))
    .orderBy(asc(workflowFolder.sortOrder), asc(workflowFolder.createdAt))

  return rows.map(toFolderApi)
}
