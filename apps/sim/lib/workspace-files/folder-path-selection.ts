import { parseFolderPath } from '@/lib/folders/paths'
import {
  type FolderIdScope,
  type FolderScopeOptions,
  isWithinFolderScope,
} from '@/lib/folders/scope'
import { collectFolderDepths } from '@/lib/folders/subtree'
import { folderPathSegments } from '@/lib/workspace-files/folder-display-path'

/** The shape a folder row needs for path resolution, so callers can pass their own. */
export interface SelectableFolder {
  id: string
  parentId: string | null
  /** Either path spelling; see {@link folderPathSegments}. */
  path: string
}

export type FolderPathSelection =
  | (FolderIdScope & { missingPath?: undefined })
  | { folderIds?: undefined; includeRootItems?: undefined; missingPath: string }

/**
 * Resolves canonical folder paths to the folder ids a run should read from.
 *
 * A folder is located by comparing decoded segments, because a stored path
 * escapes a slash inside a folder name and a canonical path percent-encodes it;
 * comparing the raw strings would miss a folder called `Q3/Q4`. Everything
 * below it is collected by walking `parentId`, which no encoding can confuse.
 *
 * `includeSubfolders: false` is expressed as a depth of zero rather than a
 * separate branch, so the narrow case cannot drift away from the wide one.
 *
 * A path that matches nothing comes back as `missingPath` instead of throwing,
 * so the caller decides how a missing folder is reported. Silently dropping it
 * would turn a typo into a quietly smaller read.
 *
 * The workspace root is reported as `includeRootItems` rather than as an entry
 * in `folderIds`, because the root is the *absence* of a folder id: a file at
 * the root carries `null`, so there is no id to match. Encoding it as a
 * sentinel string in a set of real ids would survive every type check and then
 * match nothing the first time the set reached a SQL `in (...)`.
 */
export function resolveFolderIdsForPaths(
  folders: readonly SelectableFolder[],
  folderPaths: readonly string[],
  options?: { includeSubfolders?: boolean }
): FolderPathSelection {
  const includeSubfolders = options?.includeSubfolders !== false
  const maxDepth = includeSubfolders ? undefined : 0
  const folderIds = new Set<string>()
  let includeRootItems = false

  for (const folderPath of folderPaths) {
    const segments = parseFolderPath(folderPath)
    /*
     * The root decodes to no segments, and no folder row has an empty segment
     * list, so it cannot go through the lookup below: it would resolve as a
     * missing path. It selects the files that carry no folder id, plus every
     * folder beneath it unless the scope is explicitly shallow.
     */
    if (segments.length === 0) {
      includeRootItems = true
      if (includeSubfolders) {
        for (const folder of folders) folderIds.add(folder.id)
      }
      continue
    }

    const root = folders.find((folder) => {
      const folderSegments = folderPathSegments(folder.path)
      return (
        folderSegments.length === segments.length &&
        segments.every((segment, index) => folderSegments[index] === segment)
      )
    })
    if (!root) return { missingPath: folderPath }

    folderIds.add(root.id)
    for (const id of collectFolderDepths(folders, root.id, { maxDepth }).keys()) {
      folderIds.add(id)
    }
  }

  return { folderIds, includeRootItems }
}

/**
 * Whether a file sits inside a folder scope.
 *
 * The two sides are spelled differently — a file carries the stored display
 * path, which backslash-escapes a slash inside a folder name, while a picked
 * scope is a canonical percent-encoded path — so this compares decoded segments
 * rather than the strings. A folder called `Q3/Q4` is one segment in both
 * spellings and only a segment comparison sees that.
 */
export function isFileInFolderScope(
  fileFolderPath: string | null | undefined,
  scopeCanonicalPath: string,
  options?: FolderScopeOptions
): boolean {
  const scope = parseFolderPath(scopeCanonicalPath)
  const fileSegments = fileFolderPath ? folderPathSegments(fileFolderPath) : []

  /*
   * A shallow explicit root means the files sitting AT the root, matching what
   * {@link resolveFolderIdsForPaths} selects for the same scope — otherwise the
   * picker offers files the run would not read.
   *
   * Handled here rather than in `isWithinFolderScope`, whose contract is that
   * an empty scope is no scope at all. Its other callers reach it with an empty
   * list for an UNSET filter as well as for a chosen root, and narrowing there
   * would turn their unset field into a filter. This caller never does: the
   * file picker short-circuits on an empty scope string before calling.
   */
  if (scope.length === 0 && options?.includeSubfolders === false) {
    return fileSegments.length === 0
  }

  return isWithinFolderScope(fileSegments, scope, options)
}
