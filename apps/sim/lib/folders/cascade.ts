import { type db, folder as folderTable } from '@sim/db'
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { type FolderResourceConfig, folderResourceConfig } from '@/lib/folders/config'
import { collectDescendantFolderIds } from '@/lib/folders/subtree'

/** Narrow enough for both `db` and an open transaction handle. */
type DbOrTx = Pick<typeof db, 'select' | 'update'>

export interface FolderCascadeCounts {
  folders: number
  children: number
}

function activeChildFilter(config: FolderResourceConfig, workspaceId: string, ids: SQL): SQL {
  return and(
    ids,
    eq(config.workspaceColumn, workspaceId),
    isNull(config.deletedColumn),
    config.scope
  ) as SQL
}

/**
 * Collects a folder's full subtree (itself plus every active descendant) within one
 * resourceType. The walk itself is pure and shared with the other subtree consumers.
 */
export async function collectFolderSubtreeIds(
  tx: DbOrTx,
  workspaceId: string,
  resourceType: FolderResourceType,
  folderId: string
): Promise<string[]> {
  const activeFolders = await tx
    .select({ id: folderTable.id, parentId: folderTable.parentId })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, resourceType),
        isNull(folderTable.deletedAt)
      )
    )

  return [folderId, ...collectDescendantFolderIds(activeFolders, folderId)]
}

/**
 * Soft-deletes every folder in `folderIds` and every resource contained by them, stamping
 * one shared `timestamp` across the whole cascade.
 *
 * The shared timestamp is load-bearing: {@link restoreFolderCascade} resurrects only rows
 * whose soft-delete timestamp matches the folder's exactly, which is what stops a restore
 * from also reviving siblings that were deleted independently before or after.
 *
 * Callers must already hold row locks on `folderIds` (see the `FOR UPDATE` in the delete
 * orchestration) — this function performs no locking of its own.
 */
export async function archiveFolderCascade(
  tx: DbOrTx,
  config: FolderResourceConfig,
  workspaceId: string,
  folderIds: string[],
  timestamp: Date
): Promise<FolderCascadeCounts> {
  const archivedFolders = await tx
    .update(folderTable)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(
      and(
        inArray(folderTable.id, folderIds),
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, config.resourceType),
        isNull(folderTable.deletedAt)
      )
    )
    .returning({ id: folderTable.id })

  const archivedChildren = await tx
    .update(config.table)
    .set({ [config.deletedKey]: timestamp, updatedAt: timestamp })
    .where(activeChildFilter(config, workspaceId, inArray(config.folderIdColumn, folderIds) as SQL))
    .returning({ id: config.idColumn })

  return { folders: archivedFolders.length, children: archivedChildren.length }
}

/**
 * Restores the subtree rooted at `folderId`, resurrecting only folders and resources whose
 * soft-delete timestamp equals `timestamp` — i.e. exactly what was archived together.
 *
 * Walks children explicitly rather than reusing {@link collectFolderSubtreeIds}, which only
 * sees *active* folders and by definition cannot see an archived subtree. `seen` guards
 * against a parent cycle turning the walk into infinite recursion.
 */
export async function restoreFolderCascade(
  tx: DbOrTx,
  config: FolderResourceConfig,
  workspaceId: string,
  folderId: string,
  timestamp: Date
): Promise<FolderCascadeCounts> {
  const counts: FolderCascadeCounts = { folders: 0, children: 0 }
  const seen = new Set<string>()

  const restoreSubtree = async (currentFolderId: string): Promise<void> => {
    if (seen.has(currentFolderId)) return
    seen.add(currentFolderId)

    const restoredChildren = await tx
      .update(config.table)
      .set({ [config.deletedKey]: null, updatedAt: new Date() })
      .where(
        and(
          eq(config.folderIdColumn, currentFolderId),
          eq(config.workspaceColumn, workspaceId),
          eq(config.deletedColumn, timestamp),
          config.scope
        ) as SQL
      )
      .returning({ id: config.idColumn })
    counts.children += restoredChildren.length

    const archivedChildFolders = await tx
      .select({ id: folderTable.id })
      .from(folderTable)
      .where(
        and(
          eq(folderTable.parentId, currentFolderId),
          eq(folderTable.workspaceId, workspaceId),
          eq(folderTable.resourceType, config.resourceType),
          eq(folderTable.deletedAt, timestamp)
        )
      )

    for (const child of archivedChildFolders) {
      // Re-assert the timestamp on the write: the read above is unlocked, so a concurrent
      // restore could have already claimed this row. An empty result means someone else
      // won, and this branch is skipped rather than double-counted.
      const [restored] = await tx
        .update(folderTable)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(and(eq(folderTable.id, child.id), eq(folderTable.deletedAt, timestamp)))
        .returning({ id: folderTable.id })
      if (!restored) continue
      counts.folders += 1
      await restoreSubtree(child.id)
    }
  }

  await restoreSubtree(folderId)
  return counts
}

/**
 * Maps internal cascade counts onto the per-resourceType shape the API returns, so a
 * `knowledge_base` folder reports `knowledgeBases` and a `table` folder reports `tables`.
 */
export function toCascadeCounts(
  resourceType: FolderResourceType,
  counts: FolderCascadeCounts
): { folders: number } & Partial<Record<string, number>> {
  return { folders: counts.folders, [folderResourceConfig(resourceType).countKey]: counts.children }
}
