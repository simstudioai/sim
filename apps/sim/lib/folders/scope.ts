import type { folder } from '@sim/db/schema'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface FolderScopeOptions {
  /**
   * Whether the scope reaches nested folders. Absent means yes — a folder
   * normally stands for everything under it.
   */
  includeSubfolders?: boolean
}

/**
 * Whether a folder, given as its decoded names, sits inside a scope given the
 * same way.
 *
 * Segments rather than strings, because a textual prefix is not a folder
 * ancestry: `/a/bc` starts with `/a/b` and is not inside it, and a folder
 * genuinely named `Q3/Q4` is ONE segment whose two spellings — canonical
 * `%2F` and the stored display `\/` — share no prefix at all.
 *
 * An empty scope is the workspace root, which everything is inside. That holds
 * even for `includeSubfolders: false`: the root is how a caller spells "no
 * scope", so narrowing it to the root's own direct contents would turn an
 * unset field into a filter.
 */
export function isWithinFolderScope(
  segments: readonly string[],
  scopeSegments: readonly string[],
  options?: FolderScopeOptions
): boolean {
  if (scopeSegments.length === 0) return true
  if (options?.includeSubfolders === false) {
    if (segments.length !== scopeSegments.length) return false
  } else if (segments.length < scopeSegments.length) {
    return false
  }
  return scopeSegments.every((segment, index) => segments[index] === segment)
}

/**
 * A folder scope already resolved to concrete folder ids.
 *
 * `isWithinFolderScope` answers "is this folder inside that scope" one folder
 * at a time. This is the same question asked of many items at once,
 * after the paths have been walked to ids, so a query can push it down into
 * SQL.
 *
 * The root is carried as its own flag rather than as an entry in `folderIds`,
 * because an item at the root has no folder id to match. A sentinel string
 * would type-check everywhere and then match nothing the first time the set
 * reached a SQL `in (...)`.
 */
export interface FolderIdScope {
  folderIds: Set<string>
  /** Items carrying no folder id are in scope. */
  includeRootItems: boolean
}

type FolderScope = Pick<typeof folder.$inferSelect, 'workspaceId' | 'projectId'>

/** Narrows persisted ownership to one canonical workspace folder. */
export function isWorkspaceFolder<T extends FolderScope>(
  row: T,
  workspaceId?: string
): row is T & { workspaceId: string } {
  return (
    typeof row.workspaceId === 'string' &&
    row.workspaceId.length > 0 &&
    (workspaceId === undefined || row.workspaceId === workspaceId) &&
    row.projectId === null
  )
}

/** Rejects non-workspace ownership before projecting a workspace-only folder. */
export function requireWorkspaceFolder<T extends FolderScope>(
  row: T,
  workspaceId?: string
): T & { workspaceId: string } {
  if (!isWorkspaceFolder(row, workspaceId)) {
    throw new OrchestrationError('not_found', 'Folder not found')
  }
  return row
}

/** Workspace resources retain a live creator; detached Project attribution is not a workspace identity. */
export function requireWorkspaceFolderCreator<T extends FolderScope & { userId: string | null }>(
  row: T,
  workspaceId?: string
): T & { workspaceId: string; userId: string } {
  const scoped = requireWorkspaceFolder(row, workspaceId)
  if (!scoped.userId) throw new OrchestrationError('not_found', 'Folder not found')
  return { ...scoped, userId: scoped.userId }
}
