import { db } from '@sim/db'
import { folder as folderTable, workflow as workflowTable } from '@sim/db/schema'
import { and, eq, isNull, min } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Sort order placing a new workflow above everything already in its folder.
 *
 * Workflows and folders share one ordering, so both minimums are consulted, and
 * *both* exclude soft-deleted rows. Because this returns `min - 1`, counting a
 * deleted row lets every delete ratchet the floor further negative and never
 * recover: a deleted sibling at -400 pins the next new workflow at -401 forever.
 * `lib/folders/orchestration.ts` documents the same rule for the folder-creation
 * side of this algorithm.
 *
 * Pass `tx` when the caller is inside a transaction, so the read sees that
 * transaction's uncommitted rows rather than the pre-transaction snapshot.
 */
export async function nextWorkflowSortOrder(
  workspaceId: string,
  folderId: string | null | undefined,
  tx: DbOrTx = db
): Promise<number> {
  const workflowParentCondition = folderId
    ? eq(workflowTable.folderId, folderId)
    : isNull(workflowTable.folderId)
  const folderParentCondition = folderId
    ? eq(folderTable.parentId, folderId)
    : isNull(folderTable.parentId)

  const [[workflowMinResult], [folderMinResult]] = await Promise.all([
    tx
      .select({ minOrder: min(workflowTable.sortOrder) })
      .from(workflowTable)
      .where(
        and(
          eq(workflowTable.workspaceId, workspaceId),
          workflowParentCondition,
          isNull(workflowTable.archivedAt)
        )
      ),
    tx
      .select({ minOrder: min(folderTable.sortOrder) })
      .from(folderTable)
      .where(
        and(
          eq(folderTable.workspaceId, workspaceId),
          eq(folderTable.resourceType, 'workflow'),
          folderParentCondition,
          isNull(folderTable.deletedAt)
        )
      ),
  ])

  const minSortOrder = [workflowMinResult?.minOrder, folderMinResult?.minOrder].reduce<
    number | null
  >((currentMin, candidate) => {
    if (candidate == null) return currentMin
    if (currentMin == null) return candidate
    return Math.min(currentMin, candidate)
  }, null)

  return minSortOrder != null ? minSortOrder - 1 : 0
}
