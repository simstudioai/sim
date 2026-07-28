import { knowledgeBase, userTableDefinitions, workflow, workspaceFiles } from '@sim/db'
import { eq, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { FolderResourceType } from '@/lib/api/contracts/folders'

/**
 * Counts of cascaded resources returned by a folder delete/restore, keyed per resource
 * type so a caller can render "3 workflows" vs "3 tables" without inspecting the folder.
 */
export type FolderChildCountKey = 'workflows' | 'files' | 'knowledgeBases' | 'tables'

/**
 * Everything that differs between the four folder-bearing resource types, expressed as
 * data. The folder engine in `lib/folders/orchestration.ts` reads this instead of
 * branching on `resourceType`, so create/update/delete/restore/reorder each exist exactly
 * once and adding a fifth foldered resource means adding one entry here.
 *
 * This is the deliberate departure from the original generic-folders prototype, which
 * dispatched `resourceType` to four separate backends (workflow and file folders still
 * delegated to their legacy managers). That shape forced an adapter to reshape records,
 * matching on error *strings* to classify failures, and left two writers for one table.
 */
export interface FolderResourceConfig {
  resourceType: FolderResourceType
  /** Human-readable noun used in audit-log descriptions. */
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
   * delta this config exists to capture.
   */
  deletedKey: 'deletedAt' | 'archivedAt'
  /** Narrows which rows of `table` participate in folder membership at all. */
  scope?: SQL
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
    // `workspace_files` also stores copilot/chat/execution artifacts and profile
    // pictures; only files surfaced on the Files page live in folders.
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
  },
}

export function folderResourceConfig(resourceType: FolderResourceType): FolderResourceConfig {
  return FOLDER_RESOURCES[resourceType]
}
