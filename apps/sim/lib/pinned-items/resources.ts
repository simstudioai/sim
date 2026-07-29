import {
  db,
  folder as folderTable,
  knowledgeBase,
  userTableDefinitions,
  workflow,
  workspaceFiles,
} from '@sim/db'
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { PinnedResourceType } from '@/lib/api/contracts/pinned-items'

/**
 * Per-resourceType table/column wiring for the existence checks below. The only
 * difference between resource types is which table and columns to query, so it is
 * captured as data rather than one copy-pasted branch per type — adding a pinnable
 * resource means adding one entry here.
 */
interface PinnedResourceConfig {
  table: PgTable
  idColumn: PgColumn
  workspaceColumn: PgColumn
  /** Soft-delete timestamp column; the resource is active while this is null. */
  deletedColumn: PgColumn
  /** Extra predicate narrowing which rows of `table` are pinnable at all. */
  scope?: SQL
}

const PINNED_RESOURCES: Record<PinnedResourceType, PinnedResourceConfig> = {
  workflow: {
    table: workflow,
    idColumn: workflow.id,
    workspaceColumn: workflow.workspaceId,
    deletedColumn: workflow.archivedAt,
  },
  file: {
    table: workspaceFiles,
    idColumn: workspaceFiles.id,
    workspaceColumn: workspaceFiles.workspaceId,
    deletedColumn: workspaceFiles.deletedAt,
    // `workspace_files` also stores copilot/chat/execution artifacts and profile
    // pictures. Only files surfaced on the Files page are pinnable.
    scope: eq(workspaceFiles.context, 'workspace'),
  },
  knowledge_base: {
    table: knowledgeBase,
    idColumn: knowledgeBase.id,
    workspaceColumn: knowledgeBase.workspaceId,
    deletedColumn: knowledgeBase.deletedAt,
  },
  table: {
    table: userTableDefinitions,
    idColumn: userTableDefinitions.id,
    workspaceColumn: userTableDefinitions.workspaceId,
    deletedColumn: userTableDefinitions.archivedAt,
  },
  /**
   * One entry covers every folder tree. Deliberately unscoped by `resourceType`: file,
   * knowledge-base, and table folders are all pinnable and all live in `folder`, and a
   * folder id addresses exactly one row regardless of which tree it belongs to. The
   * workspace filter below still scopes the check.
   */
  folder: {
    table: folderTable,
    idColumn: folderTable.id,
    workspaceColumn: folderTable.workspaceId,
    deletedColumn: folderTable.deletedAt,
  },
}

function activeResourceFilter(config: PinnedResourceConfig, workspaceId: string, ids: SQL): SQL {
  return and(
    ids,
    eq(config.workspaceColumn, workspaceId),
    isNull(config.deletedColumn),
    config.scope
  ) as SQL
}

/**
 * Verifies `resourceId` exists, belongs to `workspaceId`, and is not soft-deleted.
 * Without this a pin could be created against a nonexistent or cross-workspace
 * resource, which the unique index would then happily persist forever.
 */
export async function pinnableResourceExists(
  resourceType: PinnedResourceType,
  resourceId: string,
  workspaceId: string
): Promise<boolean> {
  const config = PINNED_RESOURCES[resourceType]
  const [row] = await db
    .select({ id: config.idColumn })
    .from(config.table)
    .where(activeResourceFilter(config, workspaceId, eq(config.idColumn, resourceId)))
    .limit(1)
  return Boolean(row)
}

/**
 * Drops pins whose underlying resource has since been deleted or archived. Deleting
 * a resource never touches `pinned_item`, so without this filter a pin outlives its
 * resource indefinitely and renders as a phantom row.
 *
 * Issues one query per distinct resourceType present in `rows` — O(types), not
 * O(rows) — and runs them concurrently.
 */
export async function filterToActiveResources<
  T extends { resourceType: string; resourceId: string },
>(rows: T[], workspaceId: string): Promise<T[]> {
  if (rows.length === 0) return rows

  const idsByType = new Map<PinnedResourceType, string[]>()
  for (const row of rows) {
    const type = row.resourceType as PinnedResourceType
    if (!PINNED_RESOURCES[type]) continue
    const ids = idsByType.get(type)
    if (ids) ids.push(row.resourceId)
    else idsByType.set(type, [row.resourceId])
  }

  const activeIdsByType = new Map<PinnedResourceType, Set<string>>()
  await Promise.all(
    Array.from(idsByType, async ([type, ids]) => {
      const config = PINNED_RESOURCES[type]
      const activeRows = await db
        .select({ id: config.idColumn })
        .from(config.table)
        .where(activeResourceFilter(config, workspaceId, inArray(config.idColumn, ids)))
      activeIdsByType.set(type, new Set(activeRows.map((row) => row.id as string)))
    })
  )

  return rows.filter((row) =>
    activeIdsByType.get(row.resourceType as PinnedResourceType)?.has(row.resourceId)
  )
}
