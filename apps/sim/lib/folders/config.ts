import {
  chat,
  knowledgeBase,
  userTableDefinitions,
  webhook,
  workflow,
  workflowMcpTool,
  workflowSchedule,
  workspaceFiles,
} from '@sim/db/schema'
import { eq, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { FolderResourceType } from '@/lib/api/contracts/folders'

/**
 * Counts of cascaded resources returned by a folder delete/restore, keyed per resource
 * type so a caller can render "3 workflows" vs "3 tables" without inspecting the folder.
 */
export type FolderChildCountKey = 'workflows' | 'files' | 'knowledgeBases' | 'tables'

/**
 * A table whose rows hang off a foldered resource and share its soft-delete lifecycle —
 * e.g. a workflow's schedules and webhooks. Restored alongside the resource so a folder
 * restore brings back a fully functional resource rather than a headless row.
 *
 * Archive is deliberately not expressed here: the archive direction has side effects
 * beyond a row update (deactivating deployments, notifying the socket, external webhook
 * teardown) and is owned by {@link FolderResourceConfig.archiveChildren}.
 */
export interface FolderDependentTable {
  table: PgTable
  /** Column on `table` holding the parent resource's id. */
  childIdColumn: PgColumn
  /** Soft-delete timestamp column, matched exactly against the cascade timestamp. */
  deletedColumn: PgColumn
  /** Typed at the definition site so a dropped or renamed column fails to compile. */
  buildRestoreSet: (now: Date) => Record<string, unknown>
}

/** Everything the cascade needs to archive or restore the resources inside a folder. */
export interface CascadeChildrenContext {
  workspaceId: string
  /** The folder plus every descendant folder in the cascade, already resolved. */
  folderIds: string[]
  /** Shared across the whole cascade; restore matches on it exactly. */
  timestamp: Date
}

/**
 * Reason a delete must be refused. `locked` maps to 423, matching what the table domain
 * returns when a mutation lock blocks the equivalent single-resource delete.
 */
export interface FolderDeleteRejection {
  error: string
  errorCode: 'validation' | 'conflict' | 'locked'
}

/**
 * Everything that differs between the four folder-bearing resource types, expressed as
 * data. The folder engine in `lib/folders/lifecycle.ts` and the cascade in
 * `lib/folders/cascade.ts` read this instead of branching on `resourceType`, so
 * create/update/delete/restore/reorder each exist exactly once and adding a fifth
 * foldered resource means adding one entry here.
 */
export interface FolderResourceConfig {
  resourceType: FolderResourceType
  /** Human-readable noun used in audit-log descriptions and log lines. */
  label: string
  countKey: FolderChildCountKey
  /** Table holding the resources that live *inside* folders of this type. */
  table: PgTable
  idColumn: PgColumn
  folderIdColumn: PgColumn
  workspaceColumn: PgColumn
  /** Soft-delete timestamp column; the resource is active while this is null. */
  deletedColumn: PgColumn
  /**
   * Property key backing {@link deletedColumn}. Drizzle's `.set()` takes TypeScript
   * property names while `.where()` takes column objects, so the cascade needs both.
   * These genuinely differ per table (`archivedAt` vs `deletedAt`), which is exactly the
   * delta this config exists to capture. The `.set()` payloads themselves are built by
   * {@link buildSoftDeleteSet} so they stay typed against the concrete table.
   */
  deletedKey: 'deletedAt' | 'archivedAt'
  /**
   * Builds the `.set()` payload that soft-deletes (`timestamp`) or restores (`null`) a
   * child row. Declared per resource with `satisfies Partial<typeof table.$inferInsert>`
   * so a dropped or renamed column is a compile error rather than a silent no-op — never
   * hand the cascade a `Record<string, unknown>` literal.
   */
  buildSoftDeleteSet: (timestamp: Date | null, now: Date) => Record<string, unknown>
  /**
   * Whether folders of this type participate in the folder-locking feature.
   *
   * Only workflow folders do. `folder.locked` exists because workflow-folder locking shipped
   * before the generic table; it is deliberately not extended to the other resource types.
   * Declared here rather than checked as `resourceType === 'workflow'` at each call site, so
   * every surface that touches locking asks the same question and a future lockable resource
   * is one flag rather than a hunt through routes.
   */
  supportsLocking?: boolean
  /** Narrows which rows of `table` participate in folder membership at all. */
  scope?: SQL
  /**
   * Column used to place a newly created folder above existing siblings. Only workflows
   * order their resources alongside folders; knowledge bases and tables have no per-row
   * sort order, so the new folder's position is derived from sibling folders alone.
   */
  sortOrderColumn?: PgColumn
  /** Rows restored alongside each resource; see {@link FolderDependentTable}. */
  restoreDependents?: FolderDependentTable[]
  /**
   * Replaces the cascade's default "one UPDATE over the child table" when archiving a
   * resource has side effects the row update cannot express — dependent graphs, lock
   * checks, deployment teardown. Returns the number of resources archived.
   *
   * Where a canonical single-resource delete already exists, delegate to it rather than
   * reimplementing its writes here: that is what keeps the folder cascade from drifting
   * away from the resource's own delete path.
   */
  archiveChildren?: (context: CascadeChildrenContext) => Promise<number>
  /**
   * Mirror of {@link archiveChildren} for restore. Required whenever `archiveChildren` is
   * set and the archive touched more than the child row, otherwise a restore would revive
   * the resource while leaving its dependents archived.
   *
   * Restoring a resource can also collide with its OWN active-name unique index (knowledge
   * bases and tables both have one), which the canonical restore resolves by renaming —
   * another reason to delegate rather than clear the tombstone directly.
   */
  restoreChildren?: (context: CascadeChildrenContext) => Promise<number>
  /**
   * Runs before any write on delete. Returns a rejection to refuse the delete, or `null`
   * to proceed. Use for invariants that must hold across the whole subtree, so the cascade
   * either runs completely or not at all rather than failing partway through.
   */
  guardDelete?: (context: {
    workspaceId: string
    folderIds: string[]
  }) => Promise<FolderDeleteRejection | null>
}

/**
 * Archives the workflows in a folder subtree through the workflow lifecycle rather than a
 * bare UPDATE: archiving a workflow also deactivates its deployments, tears down external
 * webhooks, notifies the realtime socket, and republishes MCP tool lists.
 *
 * Imported lazily so knowledge-base and table folder routes do not pull the workflow
 * executor, socket client, and MCP pub/sub into their module graph.
 */
async function archiveWorkflowChildren({
  workspaceId,
  folderIds,
  timestamp,
}: CascadeChildrenContext): Promise<number> {
  const [{ db }, { and, eq: eqOp, inArray, isNull }, { archiveWorkflowsByIdsInWorkspace }] =
    await Promise.all([
      import('@sim/db'),
      import('drizzle-orm'),
      import('@/lib/workflows/lifecycle'),
    ])

  const workflowsInFolders = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        inArray(workflow.folderId, folderIds),
        eqOp(workflow.workspaceId, workspaceId),
        isNull(workflow.archivedAt)
      )
    )

  if (workflowsInFolders.length === 0) return 0

  // Report what the lifecycle actually archived, not what this select saw — a workflow
  // archived concurrently between the two would otherwise be double-counted.
  return archiveWorkflowsByIdsInWorkspace(
    workspaceId,
    workflowsInFolders.map((entry) => entry.id),
    { requestId: `folder-cascade-${folderIds[0]}`, archivedAt: timestamp }
  )
}

/**
 * Refuses to archive the last active workflow(s) in a workspace. A workspace with zero
 * active workflows renders an unopenable editor, so the workflow surface has always
 * blocked this; knowledge bases and tables have no such requirement.
 */
async function guardLastWorkflows({
  workspaceId,
  folderIds,
}: {
  workspaceId: string
  folderIds: string[]
}): Promise<FolderDeleteRejection | null> {
  const [{ db }, { and, eq: eqOp, inArray, isNull }] = await Promise.all([
    import('@sim/db'),
    import('drizzle-orm'),
  ])

  const [inFolders, inWorkspace] = await Promise.all([
    db
      .select({ id: workflow.id })
      .from(workflow)
      .where(
        and(
          inArray(workflow.folderId, folderIds),
          eqOp(workflow.workspaceId, workspaceId),
          isNull(workflow.archivedAt)
        )
      ),
    db
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(eqOp(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt))),
  ])

  if (inFolders.length > 0 && inFolders.length >= inWorkspace.length) {
    return {
      error: 'Cannot delete folder containing the only workflow(s) in the workspace',
      errorCode: 'validation',
    }
  }

  return null
}

/**
 * Selects the ids of resources inside a folder subtree whose soft-delete column is in the
 * requested state — active (`null`) when archiving, or stamped with the cascade timestamp
 * when restoring.
 */
async function selectChildIds(
  config: FolderResourceConfig,
  { workspaceId, folderIds, timestamp }: CascadeChildrenContext,
  state: 'active' | 'archived'
): Promise<string[]> {
  const [{ db }, { and, eq: eqOp, inArray, isNull }] = await Promise.all([
    import('@sim/db'),
    import('drizzle-orm'),
  ])

  const rows = await db
    .select({ id: config.idColumn })
    .from(config.table)
    .where(
      and(
        inArray(config.folderIdColumn, folderIds),
        eqOp(config.workspaceColumn, workspaceId),
        state === 'active' ? isNull(config.deletedColumn) : eqOp(config.deletedColumn, timestamp),
        config.scope
      )
    )

  return rows.map((row) => String(row.id))
}

/**
 * Archives the knowledge bases in a folder subtree through the canonical KB delete, which
 * also archives their documents and pauses their connectors. A bare `knowledge_base` row
 * update would leave that graph live — connectors would keep syncing into a KB the UI shows
 * as deleted.
 */
async function archiveKnowledgeBaseChildren(context: CascadeChildrenContext): Promise<number> {
  const { deleteKnowledgeBase } = await import('@/lib/knowledge/service')
  const ids = await selectChildIds(FOLDER_RESOURCES.knowledge_base, context, 'active')

  for (const id of ids) {
    await deleteKnowledgeBase(id, `folder-cascade-${context.folderIds[0]}`, {
      archivedAt: context.timestamp,
    })
  }

  return ids.length
}

/**
 * Restores the knowledge bases this cascade archived, through the canonical KB restore so
 * documents and connectors come back with them and the KB is renamed if its name was taken
 * while it was gone.
 */
async function restoreKnowledgeBaseChildren(context: CascadeChildrenContext): Promise<number> {
  const { restoreKnowledgeBase } = await import('@/lib/knowledge/service')
  const ids = await selectChildIds(FOLDER_RESOURCES.knowledge_base, context, 'archived')
  const restoringFolderIds = new Set(context.folderIds)

  for (const id of ids) {
    await restoreKnowledgeBase(id, `folder-cascade-${context.folderIds[0]}`, {
      restoringFolderIds,
    })
  }

  return ids.length
}

/**
 * Archives the tables in a folder subtree through the canonical table delete, so the
 * `deleteLocked` guard in its WHERE clause still applies. {@link guardLockedTables} has
 * already refused the whole folder if any table is locked, so this should not encounter one.
 */
async function archiveTableChildren(context: CascadeChildrenContext): Promise<number> {
  const { deleteTable } = await import('@/lib/table/service')
  const ids = await selectChildIds(FOLDER_RESOURCES.table, context, 'active')

  for (const id of ids) {
    await deleteTable(id, `folder-cascade-${context.folderIds[0]}`, undefined, {
      archivedAt: context.timestamp,
    })
  }

  return ids.length
}

/**
 * Restores the tables this cascade archived, through the canonical table restore so a table
 * whose name was taken while it was gone is renamed instead of tripping the active-name
 * unique index.
 */
async function restoreTableChildren(context: CascadeChildrenContext): Promise<number> {
  const { restoreTable } = await import('@/lib/table/service')
  const ids = await selectChildIds(FOLDER_RESOURCES.table, context, 'archived')
  const restoringFolderIds = new Set(context.folderIds)

  for (const id of ids) {
    await restoreTable(id, `folder-cascade-${context.folderIds[0]}`, { restoringFolderIds })
  }

  return ids.length
}

/**
 * Refuses to delete a folder containing a delete-locked table.
 *
 * `deleteTable` gates archiving on `deleteLocked` because archiving destroys access to every
 * row. Deleting the folder around it must not become a way to bypass that control. Checked
 * across the whole subtree up front so the cascade never archives half the tables and then
 * stops at a locked one.
 */
async function guardLockedTables({
  workspaceId,
  folderIds,
}: {
  workspaceId: string
  folderIds: string[]
}): Promise<FolderDeleteRejection | null> {
  const [{ db }, { and, eq: eqOp, inArray, isNull }] = await Promise.all([
    import('@sim/db'),
    import('drizzle-orm'),
  ])

  const locked = await db
    .select({ name: userTableDefinitions.name })
    .from(userTableDefinitions)
    .where(
      and(
        inArray(userTableDefinitions.folderId, folderIds),
        eqOp(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt),
        eqOp(userTableDefinitions.deleteLocked, true)
      )
    )

  if (locked.length === 0) return null

  const names = locked.map((row) => row.name).join(', ')
  return {
    error: `Cannot delete folder: ${locked.length === 1 ? 'table' : 'tables'} ${names} ${locked.length === 1 ? 'is' : 'are'} delete-locked`,
    errorCode: 'locked',
  }
}

export const FOLDER_RESOURCES: Record<FolderResourceType, FolderResourceConfig> = {
  workflow: {
    resourceType: 'workflow',
    label: 'workflow',
    countKey: 'workflows',
    table: workflow,
    idColumn: workflow.id,
    folderIdColumn: workflow.folderId,
    workspaceColumn: workflow.workspaceId,
    deletedColumn: workflow.archivedAt,
    deletedKey: 'archivedAt',
    buildSoftDeleteSet: (timestamp, now) =>
      ({ archivedAt: timestamp, updatedAt: now }) satisfies Partial<typeof workflow.$inferInsert>,
    sortOrderColumn: workflow.sortOrder,
    /**
     * Restored in bulk rather than through a `restoreChildren` hook. `restoreFolderChildren`
     * already matches these on the archive timestamp, so a webhook or chat the user archived
     * independently stays archived — and it does so in a fixed number of statements inside the
     * restore transaction. Routing them through `restoreWorkflow` instead would add a
     * per-workflow read/transaction/read outside that transaction: ~1600 round trips for a
     * folder of 200 workflows, and a window where the workflows are active but the folder is
     * not. It would also buy nothing, since `restoreWorkflow` clears exactly these columns.
     *
     * What none of these can undo is the state `archiveWorkflow` overwrites — schedules go to
     * `status: 'disabled'` with `nextRunAt` cleared, webhooks and chats to `isActive: false`.
     * Archive does not record what those were, so restoring them to a constant would re-enable
     * a schedule the user had disabled and re-run a completed one. Re-enabling stays explicit
     * (redeploy re-activates a schedule), matching deployment state, which restore also leaves
     * off on purpose.
     */
    restoreDependents: [
      {
        table: workflowSchedule,
        childIdColumn: workflowSchedule.workflowId,
        deletedColumn: workflowSchedule.archivedAt,
        buildRestoreSet: (now) =>
          ({ archivedAt: null, updatedAt: now }) satisfies Partial<
            typeof workflowSchedule.$inferInsert
          >,
      },
      {
        table: webhook,
        childIdColumn: webhook.workflowId,
        deletedColumn: webhook.archivedAt,
        buildRestoreSet: (now) =>
          ({ archivedAt: null, updatedAt: now }) satisfies Partial<typeof webhook.$inferInsert>,
      },
      {
        table: chat,
        childIdColumn: chat.workflowId,
        deletedColumn: chat.archivedAt,
        buildRestoreSet: (now) =>
          ({ archivedAt: null, updatedAt: now }) satisfies Partial<typeof chat.$inferInsert>,
      },
      {
        table: workflowMcpTool,
        childIdColumn: workflowMcpTool.workflowId,
        deletedColumn: workflowMcpTool.archivedAt,
        buildRestoreSet: (now) =>
          ({ archivedAt: null, updatedAt: now }) satisfies Partial<
            typeof workflowMcpTool.$inferInsert
          >,
      },
    ],
    supportsLocking: true,
    archiveChildren: archiveWorkflowChildren,
    guardDelete: guardLastWorkflows,
  },
  /**
   * Present to satisfy the total `Record<FolderResourceType, …>`, but UNREACHABLE at runtime:
   * `servedFolderResourceTypeSchema` does not serve `'file'`, and the Files surface goes through
   * `workspace-file-folder-manager.ts` instead. Do not treat this entry as a live path — routing
   * file folders through the generic engine would bypass the `workspace_file_folders:` advisory
   * lock that makes its check-then-write pairs atomic, and the name rules that keep a folder name
   * usable as a path segment.
   */
  file: {
    resourceType: 'file',
    label: 'file',
    countKey: 'files',
    table: workspaceFiles,
    idColumn: workspaceFiles.id,
    folderIdColumn: workspaceFiles.folderId,
    workspaceColumn: workspaceFiles.workspaceId,
    deletedColumn: workspaceFiles.deletedAt,
    deletedKey: 'deletedAt',
    buildSoftDeleteSet: (timestamp) =>
      ({ deletedAt: timestamp }) satisfies Partial<typeof workspaceFiles.$inferInsert>,
    /**
     * `workspace_files` also stores copilot/chat/execution artifacts and profile pictures;
     * only files surfaced on the Files page live in folders.
     */
    scope: eq(workspaceFiles.context, 'workspace'),
  },
  knowledge_base: {
    resourceType: 'knowledge_base',
    label: 'knowledge base',
    countKey: 'knowledgeBases',
    table: knowledgeBase,
    idColumn: knowledgeBase.id,
    folderIdColumn: knowledgeBase.folderId,
    workspaceColumn: knowledgeBase.workspaceId,
    deletedColumn: knowledgeBase.deletedAt,
    deletedKey: 'deletedAt',
    buildSoftDeleteSet: (timestamp, now) =>
      ({ deletedAt: timestamp, updatedAt: now }) satisfies Partial<
        typeof knowledgeBase.$inferInsert
      >,
    archiveChildren: archiveKnowledgeBaseChildren,
    restoreChildren: restoreKnowledgeBaseChildren,
  },
  table: {
    resourceType: 'table',
    label: 'table',
    countKey: 'tables',
    table: userTableDefinitions,
    idColumn: userTableDefinitions.id,
    folderIdColumn: userTableDefinitions.folderId,
    workspaceColumn: userTableDefinitions.workspaceId,
    deletedColumn: userTableDefinitions.archivedAt,
    deletedKey: 'archivedAt',
    buildSoftDeleteSet: (timestamp, now) =>
      ({ archivedAt: timestamp, updatedAt: now }) satisfies Partial<
        typeof userTableDefinitions.$inferInsert
      >,
    archiveChildren: archiveTableChildren,
    restoreChildren: restoreTableChildren,
    guardDelete: guardLockedTables,
  },
}

export function folderResourceConfig(resourceType: FolderResourceType): FolderResourceConfig {
  return FOLDER_RESOURCES[resourceType]
}
