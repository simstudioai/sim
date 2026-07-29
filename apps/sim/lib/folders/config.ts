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

/** Everything the cascade needs to archive the resources inside a folder. */
export interface ArchiveChildrenContext {
  workspaceId: string
  /** The folder plus every active descendant folder, already resolved. */
  folderIds: string[]
  /** Shared across the whole cascade; restore matches on it exactly. */
  timestamp: Date
}

/** Reason a delete must be refused, in the orchestration error vocabulary. */
export interface FolderDeleteRejection {
  error: string
  errorCode: 'validation' | 'conflict'
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
   * resource has side effects the row update cannot express. Returns the number of
   * resources archived.
   */
  archiveChildren?: (context: ArchiveChildrenContext) => Promise<number>
  /**
   * Runs before any write on delete. Returns a rejection to refuse the delete, or `null`
   * to proceed.
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
}: ArchiveChildrenContext): Promise<number> {
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

  await archiveWorkflowsByIdsInWorkspace(
    workspaceId,
    workflowsInFolders.map((entry) => entry.id),
    { requestId: `folder-cascade-${folderIds[0]}`, archivedAt: timestamp }
  )

  return workflowsInFolders.length
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
    archiveChildren: archiveWorkflowChildren,
    guardDelete: guardLastWorkflows,
  },
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
  },
}

export function folderResourceConfig(resourceType: FolderResourceType): FolderResourceConfig {
  return FOLDER_RESOURCES[resourceType]
}
