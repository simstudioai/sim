/**
 * A `Resource.Table` row is addressed by a single id, but a foldered list interleaves two
 * kinds of row. Namespacing the ids lets one selection `Set`, one context-menu handler, and
 * one drop-target predicate cover both without a parallel lookup.
 */
const FOLDER_ROW_PREFIX = 'folder:'

export type FolderedRowKind = 'folder' | 'resource'

export interface ParsedFolderedRowId {
  kind: FolderedRowKind
  id: string
}

export function folderRowId(folderId: string): string {
  return `${FOLDER_ROW_PREFIX}${folderId}`
}

/**
 * Resource rows keep their bare id so existing handlers, deep links, and cached selections
 * that predate folders keep resolving; only folder rows carry a prefix.
 */
export function parseFolderedRowId(rowId: string): ParsedFolderedRowId {
  if (rowId.startsWith(FOLDER_ROW_PREFIX)) {
    return { kind: 'folder', id: rowId.slice(FOLDER_ROW_PREFIX.length) }
  }
  return { kind: 'resource', id: rowId }
}
