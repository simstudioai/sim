import { parseFolderPath } from '@/lib/folders/paths'
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
  | { folderIds: Set<string>; missingPath?: undefined }
  | { folderIds?: undefined; missingPath: string }

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
 */
export function resolveFolderIdsForPaths(
  folders: readonly SelectableFolder[],
  folderPaths: readonly string[],
  options?: { includeSubfolders?: boolean }
): FolderPathSelection {
  const maxDepth = options?.includeSubfolders === false ? 0 : undefined
  const folderIds = new Set<string>()

  for (const folderPath of folderPaths) {
    const segments = parseFolderPath(folderPath)
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

  return { folderIds }
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
  options?: { includeSubfolders?: boolean }
): boolean {
  const scope = parseFolderPath(scopeCanonicalPath)
  if (scope.length === 0) return true

  const fileSegments = fileFolderPath ? folderPathSegments(fileFolderPath) : []
  if (options?.includeSubfolders === false) {
    if (fileSegments.length !== scope.length) return false
  } else if (fileSegments.length < scope.length) {
    return false
  }
  return scope.every((segment, index) => fileSegments[index] === segment)
}
