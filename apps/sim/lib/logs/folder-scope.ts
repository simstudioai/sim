import { workflow } from '@sim/db/schema'
import { inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { loadActiveFolderPathIndex, resolveFolderPathFilter } from '@/lib/folders/queries'

/** The folders a `folderPaths` filter selects, with the workspace root carried separately. */
export interface LogFolderScope {
  includesRoot: boolean
  folderIds: string[]
}

/**
 * The folders a set of canonical paths selects: each named folder AND its whole
 * subtree.
 *
 * Subtree coverage is what "filter by folder" means everywhere else in the
 * product — the first-party list, export, and stats reads all expand to
 * descendants — so resolving each path to exactly one id silently omitted every
 * run in a nested folder and answered with a plausible-looking short page.
 *
 * Expansion is by canonical path prefix over the index that is already loaded to
 * resolve the paths in the first place: a descendant of `/a` is exactly a folder
 * whose canonical path starts with `/a/`. That is exact by construction, because
 * canonical paths cannot alias, and it costs one pass over a map already in
 * memory rather than a second recursive query.
 *
 * The root is the one path that must never expand. `/` is a prefix of every path
 * in the workspace, so expanding it would turn "runs at the workspace root" into
 * "every run" — inverting the filter rather than widening it. It is carried as
 * `includesRoot` instead, because a root-level workflow has a null `folder_id`
 * and no id to match on.
 *
 * A path naming no active folder contributes nothing rather than failing the
 * read, matching {@link resolveFolderPathFilter}'s miss semantics: a filter's
 * miss is an empty set, not a 404.
 *
 * Capped at {@link MAX_FOLDERS_PER_WORKSPACE} like every other reader that
 * materializes the tree. An uncapped read is unbounded in a workspace that is
 * already over the ceiling, and a truncated index is worse than a refusal here:
 * a missing descendant silently narrows the filter, which on a log search reads
 * as "those runs do not exist".
 */
export async function resolveLogFolderScope(
  workspaceId: string,
  paths: string[]
): Promise<LogFolderScope> {
  const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'workflow', undefined, {
    maxRows: MAX_FOLDERS_PER_WORKSPACE,
  })
  const folderIds = new Set<string>()
  let includesRoot = false

  for (const path of paths) {
    const filter = resolveFolderPathFilter(folderIndex, path)
    if (filter.kind !== 'folder') continue
    if (filter.folderId === null || path === ROOT_FOLDER_PATH) {
      includesRoot = true
      continue
    }
    folderIds.add(filter.folderId)
    const prefix = `${path}/`
    for (const [folderId, folderPath] of folderIndex.pathById) {
      if (folderPath.startsWith(prefix)) folderIds.add(folderId)
    }
  }

  return { includesRoot, folderIds: [...folderIds] }
}

/**
 * The root/non-root predicate for a resolved folder scope.
 *
 * A scope carrying neither the root nor any folder id is a `folderPaths` filter
 * that matched no active folder, and it must match no rows — hence the explicit
 * unsatisfiable predicate. Building it by `or`-ing two optional halves instead
 * would hand the empty case to `or(undefined, undefined)`, which is `undefined`
 * in Drizzle: the filter drops out of the surrounding `and(...)` and the query
 * returns the workspace's entire log set, the exact opposite of what was asked.
 */
export function folderScopeCondition(scope: LogFolderScope): SQL {
  const parts = [
    scope.includesRoot ? isNull(workflow.folderId) : undefined,
    scope.folderIds.length > 0 ? inArray(workflow.folderId, scope.folderIds) : undefined,
  ].filter((part): part is SQL => part !== undefined)

  if (parts.length === 0) return sql`false`
  if (parts.length === 1) return parts[0]
  return or(...parts) ?? sql`false`
}

/**
 * The version stamped into a log cursor whenever a `folderPaths` filter is
 * active.
 *
 * The path strings a caller sends did not change when folder filters gained
 * subtree coverage, but the set of runs they select did. Without a version in
 * the fingerprint, a cursor minted before the change decodes cleanly and resumes
 * inside a now-larger sequence, silently skipping every run that sorts before
 * its position — the failure mode cursor binding exists to prevent. Bumping this
 * turns those in-flight tokens into the canonical "restart paging" 400.
 *
 * Stamped only when `folderPaths` is present, so unfiltered walks resume across
 * the deploy untouched. Bump it again for any future change to what a folder
 * path selects.
 */
export const LOG_FOLDER_SCOPE_VERSION = 2
