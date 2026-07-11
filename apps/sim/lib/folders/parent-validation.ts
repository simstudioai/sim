import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import type { DbOrTx } from '@/lib/db/types'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'

/**
 * Validates a prospective parent folder for a create/update against the
 * generic `folder` table: it must exist, be un-deleted, belong to the target
 * workspace, and (defense-in-depth alongside the DB trigger) match resourceType.
 * Mirrors the DB-level `folder_parent_resource_type_match` trigger.
 *
 * Kept in its own leaf module (no imports from `folders/orchestration.ts` or
 * `workflows/orchestration/folder-lifecycle.ts`) so both of those modules —
 * which import from each other — can share this single validation without a
 * circular import.
 */
export async function assertFolderParentValid(
  parentId: string | null | undefined,
  ctx: { workspaceId: string; resourceType: FolderResourceType },
  dbClient: DbOrTx = db
): Promise<{ error: string; errorCode: OrchestrationErrorCode } | null> {
  if (!parentId) return null

  const [parent] = await dbClient
    .select({
      workspaceId: folder.workspaceId,
      resourceType: folder.resourceType,
      deletedAt: folder.deletedAt,
    })
    .from(folder)
    .where(eq(folder.id, parentId))
    .limit(1)

  if (
    !parent ||
    parent.workspaceId !== ctx.workspaceId ||
    parent.resourceType !== ctx.resourceType ||
    parent.deletedAt
  ) {
    return { error: 'Parent folder not found', errorCode: 'validation' }
  }

  return null
}

/**
 * Walks `parentId` up from `newParentId` toward the root, returning `true` if
 * it ever reaches `folderId` (or revisits a folder, guarding against an
 * already-corrupt chain) -- i.e. whether reparenting `folderId` under
 * `newParentId` would create a cycle. Folder ids are globally unique (not
 * scoped per resourceType), so this needs no resourceType filter.
 */
export async function checkFolderCircularReference(
  folderId: string,
  newParentId: string,
  dbClient: DbOrTx = db
): Promise<boolean> {
  let currentParentId: string | null = newParentId
  const visited = new Set<string>()

  while (currentParentId) {
    if (visited.has(currentParentId) || currentParentId === folderId) {
      return true
    }
    visited.add(currentParentId)

    const [parent] = await dbClient
      .select({ parentId: folder.parentId })
      .from(folder)
      .where(eq(folder.id, currentParentId))
      .limit(1)

    currentParentId = parent?.parentId ?? null
  }

  return false
}
