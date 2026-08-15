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

/**
 * Splits a selection of foldered row ids into the two id lists every bulk operation takes.
 *
 * A foldered list holds folder rows and resource rows in one selection (see
 * {@link folderRowId}), so every consumer needs this same split before it can call an API.
 */
export function splitFolderedRowIds(rowIds: Iterable<string>): {
  folderIds: string[]
  resourceIds: string[]
} {
  const folderIds: string[] = []
  const resourceIds: string[] = []
  for (const rowId of rowIds) {
    const parsed = parseFolderedRowId(rowId)
    if (parsed.kind === 'folder') folderIds.push(parsed.id)
    else resourceIds.push(parsed.id)
  }
  return { folderIds, resourceIds }
}
