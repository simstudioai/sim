import { workspaceFiles } from '@sim/db/schema'
import { eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { FolderIdScope } from '@/lib/folders/scope'
import { OWNED_FILE_CONTEXTS } from '@/lib/workspace-files/owned-files'

/** Durable files available to workspace resource pickers, reference mappings, and fork copies. */
export function activeWorkspaceFileConditions(workspaceIds: string[]) {
  return [
    inArray(workspaceFiles.workspaceId, workspaceIds),
    eq(workspaceFiles.context, 'workspace'),
    isNull(workspaceFiles.deletedAt),
  ]
}

/** Rows whose content the editor and Sim write: workspace files and owned files. */
export const contentWritableWorkspaceFileContextCondition = inArray(workspaceFiles.context, [
  'workspace',
  ...OWNED_FILE_CONTEXTS,
])

/**
 * The folder key the folder-scoped `workspace_files` indexes are built on: the folder id, or `''`
 * for the root. `workspace_files_workspace_folder_name_active_unique` (and its Project twin) lead
 * with `coalesce(folder_id, '')`, so a folder predicate spelled as `folder_id IS NULL` or
 * `folder_id = $1` cannot seek them and reads every live file of the owner instead.
 */
export const workspaceFileFolderKey = sql<string>`coalesce(${workspaceFiles.folderId}, '')`

/** The {@link workspaceFileFolderKey} value for a folder id, `null` being the root. */
function folderKeyValue(folderId: string | null): string {
  if (folderId === '') {
    throw new OrchestrationError('validation', 'Folder id must not be empty')
  }
  return folderId ?? ''
}

/**
 * The `workspaceFiles` predicate for one folder (`null` for the root), or several folder ids,
 * on {@link workspaceFileFolderKey}. Identical in meaning to `folder_id IS NULL` / `= $1` /
 * `IN (...)` because no folder id is `''` (ids are generated, and an empty id is refused here).
 * An empty list matches nothing.
 */
export function workspaceFileFolderIdCondition(
  folderId: string | null | readonly (string | null)[]
): SQL {
  if (typeof folderId === 'string' || folderId === null) {
    return sql`${workspaceFileFolderKey} = ${folderKeyValue(folderId)}`
  }
  const keys = [...new Set(folderId.map(folderKeyValue))]
  if (keys.length === 0) return sql`false`
  return inArray(workspaceFileFolderKey, keys)
}

/**
 * The `workspaceFiles` predicate for a resolved folder scope, or none when the
 * scope is absent. A root scope selects the files that carry no folder id. An
 * empty scope selects nothing: every path resolved to a folder holding no
 * subtree, and answering it unrestricted would widen it to the whole workspace.
 */
export function workspaceFileFolderScopeCondition(
  scope: FolderIdScope | undefined
): SQL | undefined {
  if (!scope) return undefined
  return workspaceFileFolderIdCondition([
    ...scope.folderIds,
    ...(scope.includeRootItems ? [null] : []),
  ])
}
