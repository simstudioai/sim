import { workspaceFiles } from '@sim/db/schema'
import { eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
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
 * The `workspaceFiles` predicate for a resolved folder scope, or none when the
 * scope is absent. A root scope selects the files that carry no folder id, so
 * the two halves are OR-ed. An empty scope selects nothing: every path resolved
 * to a folder holding no subtree, and answering it unrestricted would widen it
 * to the whole workspace.
 */
export function workspaceFileFolderScopeCondition(
  scope: FolderIdScope | undefined
): SQL | undefined {
  if (!scope) return undefined
  const ids = [...scope.folderIds]
  const inScope = ids.length > 0 ? inArray(workspaceFiles.folderId, ids) : undefined
  const atRoot = scope.includeRootItems ? isNull(workspaceFiles.folderId) : undefined
  if (inScope && atRoot) return or(inScope, atRoot)
  return inScope ?? atRoot ?? sql`false`
}
