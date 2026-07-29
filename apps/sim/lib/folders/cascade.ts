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
 * The shared timestamp is load-bearing: the restore path resurrects only rows whose
 * soft-delete timestamp matches the folder's exactly, which is what stops a restore from
 * also reviving siblings that were deleted independently.
 *
 * Folders are stamped BEFORE their children, which is what makes a failed cascade
 * recoverable. `archiveChildren` hooks walk resources one at a time through their canonical
 * delete, so a mid-loop failure can leave some children archived and some not. With the
 * folder already stamped, `deleteFolder` reuses that same `deletedAt` on the retry and the
 * stragglers join the original snapshot. Stamping children first would leave the folder
 * active, so a retry would mint a fresh timestamp and the partially-archived children could
 * never be matched by any restore again.
 *
 * The cost is a window where the folder reads as deleted while a resource inside it is still
 * active. That is the strictly better failure: it is transient and self-healing on retry,
 * where the alternative silently and permanently strands data.
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

  const children = config.archiveChildren
    ? await config.archiveChildren({ workspaceId, folderIds, timestamp })
    : (
        await tx
          .update(config.table)
          .set(config.buildSoftDeleteSet(timestamp, timestamp))
          .where(and(childFilter(config, workspaceId, folderIds), isNull(config.deletedColumn)))
          .returning({ id: config.idColumn })
      ).length

  return { folders: archivedFolders.length, children }
}

/**
 * Un-archives the folder rows of a restore cascade — the subtree resolved by
 * {@link collectArchivedSubtreeIds}, matched on the exact `timestamp`.
 *
 * One statement regardless of subtree depth. Returns how many folders came back.
 */
export async function restoreFolderRows(
  tx: DbOrTx,
  config: FolderResourceConfig,
  workspaceId: string,
  folderIds: string[],
  timestamp: Date,
  now: Date
): Promise<number> {
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

  return restoredFolders.length
}

/**
 * Un-archives the resources a restore cascade covers, plus the dependent rows (schedules,
 * webhooks, chats) hanging off them — the default path, for resources whose restore is a
 * plain row update.
 *
 * Fixed statement count regardless of subtree depth: one UPDATE for the resources and one
 * per declared dependent table. Resources whose restore needs more than this declare
 * {@link FolderResourceConfig.restoreChildren} instead and never reach here.
 */
export async function restoreFolderChildren(
  tx: DbOrTx,
  config: FolderResourceConfig,
  workspaceId: string,
  folderIds: string[],
  timestamp: Date,
  now: Date
): Promise<number> {
  const restoredChildren = await tx
    .update(config.table)
    .set(config.buildSoftDeleteSet(null, now))
    .where(and(childFilter(config, workspaceId, folderIds), eq(config.deletedColumn, timestamp)))
    .returning({ id: config.idColumn })

  const childIds = restoredChildren.map((row) => String(row.id))

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

  return childIds.length
}

/**
 * Restores a folder subtree and the resources inside it, via the default row-update path.
 *
 * Only valid for resources without a {@link FolderResourceConfig.restoreChildren} hook —
 * those hooks call canonical single-resource restores that open their own transactions and
 * therefore must not run nested inside this one. `restoreFolder` sequences that case itself.
 */
export async function restoreFolderCascade(
  tx: DbOrTx,
  config: FolderResourceConfig,
  workspaceId: string,
  folderIds: string[],
  timestamp: Date,
  now: Date
): Promise<FolderCascadeCounts> {
  const folders = await restoreFolderRows(tx, config, workspaceId, folderIds, timestamp, now)
  const children = await restoreFolderChildren(tx, config, workspaceId, folderIds, timestamp, now)

  return { folders, children }
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
