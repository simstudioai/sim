import type { db } from '@sim/db'
import { folder as folderTable } from '@sim/db/schema'
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { FolderCascadeCountsApi, FolderResourceType } from '@/lib/api/contracts/folders'
import type { FolderResourceConfig } from '@/lib/folders/config'
import { collectDescendantFolderIds } from '@/lib/folders/subtree'

/** Narrow enough for both `db` and an open transaction handle. */
export type DbOrTx = Pick<typeof db, 'select' | 'update'>

export interface FolderCascadeCounts {
  /** Folders in the cascade, including the root. */
  folders: number
  /** Resources of the folder's own type that moved with it. */
  children: number
}

/**
 * Resolves the folder plus every *active* descendant, in one query. Used by delete: an
 * archived descendant was archived independently and keeps its own timestamp, so it must
 * not be swept into this cascade.
 */
export async function collectActiveSubtreeIds(
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
 * Resolves the folder plus every descendant archived in the same cascade, in one query.
 *
 * Matching on the exact `timestamp` is what stops a restore from also reviving folders
 * that were archived independently before or after — and is why this cannot reuse
 * {@link collectActiveSubtreeIds}, which by definition cannot see an archived subtree.
 */
export async function collectArchivedSubtreeIds(
  tx: DbOrTx,
  workspaceId: string,
  resourceType: FolderResourceType,
  folderId: string,
  timestamp: Date
): Promise<string[]> {
  const archivedFolders = await tx
    .select({ id: folderTable.id, parentId: folderTable.parentId })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, resourceType),
        eq(folderTable.deletedAt, timestamp)
      )
    )

  return [folderId, ...collectDescendantFolderIds(archivedFolders, folderId)]
}

function childFilter(config: FolderResourceConfig, workspaceId: string, folderIds: string[]): SQL {
  return and(
    inArray(config.folderIdColumn, folderIds),
    eq(config.workspaceColumn, workspaceId),
    config.scope
  ) as SQL
}

/**
 * Soft-deletes every folder in `folderIds` and every resource contained by them, stamping
 * one shared `timestamp` across the whole cascade.
 *
 * The shared timestamp is load-bearing: {@link restoreFolderCascade} resurrects only rows
 * whose soft-delete timestamp matches the folder's exactly, which is what stops a restore
 * from also reviving siblings that were deleted independently.
 *
 * Children are archived before folders so a concurrent reader never sees an active
 * resource inside a folder that has already vanished from the tree.
 */
export async function archiveFolderCascade(
  tx: DbOrTx,
  config: FolderResourceConfig,
  workspaceId: string,
  folderIds: string[],
  timestamp: Date
): Promise<FolderCascadeCounts> {
  const children = config.archiveChildren
    ? await config.archiveChildren({ workspaceId, folderIds, timestamp })
    : (
        await tx
          .update(config.table)
          .set(config.buildSoftDeleteSet(timestamp, timestamp))
          .where(and(childFilter(config, workspaceId, folderIds), isNull(config.deletedColumn)))
          .returning({ id: config.idColumn })
      ).length

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

  return { folders: archivedFolders.length, children }
}

/**
 * Restores `folderIds` — the subtree resolved by {@link collectArchivedSubtreeIds} — plus
 * every resource archived at the same `timestamp`, then reactivates the dependent rows
 * (schedules, webhooks, chats) hanging off those resources.
 *
 * Fixed query count regardless of subtree depth: one UPDATE for the folders, one for the
 * resources, and one per declared dependent table.
 */
export async function restoreFolderCascade(
  tx: DbOrTx,
  config: FolderResourceConfig,
  workspaceId: string,
  folderIds: string[],
  timestamp: Date,
  now: Date
): Promise<FolderCascadeCounts> {
  const restoredFolders = await tx
    .update(folderTable)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(
        inArray(folderTable.id, folderIds),
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, config.resourceType),
        eq(folderTable.deletedAt, timestamp)
      )
    )
    .returning({ id: folderTable.id })

  const restoredChildren = await tx
    .update(config.table)
    .set(config.buildSoftDeleteSet(null, now))
    .where(and(childFilter(config, workspaceId, folderIds), eq(config.deletedColumn, timestamp)))
    .returning({ id: config.idColumn })

  const childIds = restoredChildren.map((row) => row.id as string)

  if (childIds.length > 0) {
    for (const dependent of config.restoreDependents ?? []) {
      await tx
        .update(dependent.table)
        .set(dependent.buildRestoreSet(now))
        .where(
          and(inArray(dependent.childIdColumn, childIds), eq(dependent.deletedColumn, timestamp))
        )
    }
  }

  return { folders: restoredFolders.length, children: childIds.length }
}

/**
 * Maps internal cascade counts onto the per-resourceType shape the API returns, so a
 * `knowledge_base` folder reports `knowledgeBases` and a `table` folder reports `tables`.
 */
export function toCascadeCounts(
  config: FolderResourceConfig,
  counts: FolderCascadeCounts
): FolderCascadeCountsApi {
  return { folders: counts.folders, [config.countKey]: counts.children }
}
