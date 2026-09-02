import { parseFolderPath } from '@/lib/folders/paths'
import { isWithinFolderScope } from '@/lib/folders/scope'
import { getCanonicalFolderPath } from '@/hooks/queries/utils/folder-tree'
import type { WorkflowFolder } from '@/stores/folders/types'

/** The shape the scope filter needs from a table row. */
export interface ScopableTable {
  folderId?: string | null
}

/**
 * Decodes a scope path once for a whole list.
 *
 * {@link isTableInFolderScope} would otherwise re-parse the same scope for every
 * row, and parsing re-encodes each segment to prove canonicality — real work,
 * repeated per table. `null` means the scope is unusable, which fails open.
 */
export function parseFolderScope(scopePath: string): string[] | null {
  if (!scopePath) return []
  try {
    return parseFolderPath(scopePath)
  } catch {
    return null
  }
}

/**
 * Whether a table survives the folder scope its picker is narrowed by.
 *
 * Pure and separate from the component because the interesting behaviour is the
 * failure mode, not the happy path: an unparseable scope or a folder the client
 * cache has not loaded yet must leave the table OFFERED. A table nobody can
 * select reads as "this table is gone" rather than "the filter is malformed",
 * and failing open is the recoverable direction.
 *
 * An empty scope is no scope at all, so everything passes without touching the
 * folder map.
 */
export function isTableInFolderScope(
  table: ScopableTable,
  folders: Record<string, WorkflowFolder>,
  scope: string | string[] | null
): boolean {
  const scopeSegments = typeof scope === 'string' ? parseFolderScope(scope) : scope
  if (scopeSegments === null || scopeSegments.length === 0) return true
  try {
    return isWithinFolderScope(
      parseFolderPath(getCanonicalFolderPath(table.folderId, folders)),
      scopeSegments
    )
  } catch {
    return true
  }
}
