import { parseFolderPath } from '@/lib/folders/paths'

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
 * Whether a canonical folder path sits inside a canonical folder scope.
 *
 * For the resource types whose folders are addressed by canonical path on both
 * sides — workflows, knowledge bases, and tables. Workspace files store a
 * backslash-escaped display path instead and go through
 * `isFileInFolderScope`, which decodes its side before comparing.
 */
export function isFolderPathWithinScope(
  folderPath: string,
  scopePath: string,
  options?: FolderScopeOptions
): boolean {
  return isWithinFolderScope(parseFolderPath(folderPath), parseFolderPath(scopePath), options)
}
