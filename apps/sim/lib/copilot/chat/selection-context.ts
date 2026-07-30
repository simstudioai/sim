/**
 * Shared bounds and label helpers for selection-scoped chat contexts
 * (`file_selection`, `table_selection`). Kept free of server-only imports so
 * both the client producers (file/table viewers) and the server validator /
 * resolver can consume the same limits and formatting.
 */

import { truncate } from '@sim/utils/string'

/**
 * Max characters of selected file text carried inline on a `file_selection`.
 * This is the ceiling on the FINAL serialized string, matched by the server
 * schema's `.max(...)`; always truncate through {@link truncateSelectionText}
 * so the trailing ellipsis can't push the value past this bound.
 */
export const MAX_FILE_SELECTION_TEXT_LENGTH = 20_000

/** Max rows referenced by a single `table_selection`. */
export const MAX_TABLE_SELECTION_ROWS = 500

/** Max columns referenced by a `table_selection` cell range. */
export const MAX_TABLE_SELECTION_COLUMNS = 200

/** Length of the ellipsis {@link truncate} appends when it shortens a string. */
const TRUNCATE_SUFFIX_LENGTH = 3

/**
 * Truncates selected file text so the RESULT (including the appended ellipsis)
 * never exceeds {@link MAX_FILE_SELECTION_TEXT_LENGTH} — keeping the client
 * payload within the server schema bound, which otherwise rejects the whole
 * chat request.
 */
export function truncateSelectionText(text: string): string {
  return truncate(text, MAX_FILE_SELECTION_TEXT_LENGTH - TRUNCATE_SUFFIX_LENGTH)
}

/**
 * Builds the IDE-style chip label for a file selection, e.g. `notes.md:12-40`,
 * `notes.md:12`, or just `notes.md` when no line range is known. An optional
 * trailing `key` (from {@link selectionKey}) disambiguates two distinct passages
 * that share the same line range — without it their labels collide and the
 * second chip is dropped (chips are keyed by their `@label`). Kept ASCII so the
 * label survives being inserted as an inline mention token in the chat input.
 */
export function buildFileSelectionLabel(
  fileName: string,
  startLine?: number,
  endLine?: number,
  key?: string
): string {
  const suffix = key ? ` #${key}` : ''
  if (!startLine) return `${fileName}${suffix}`
  const range = endLine && endLine !== startLine ? `${startLine}-${endLine}` : `${startLine}`
  return `${fileName}:${range}${suffix}`
}

/**
 * Short, deterministic key for a set of ids — same ids (any order) yield the
 * same key. Used to disambiguate table-selection labels so two distinct
 * selections of the same size don't collapse to one chip (chips are keyed by
 * their `@label`, and a collision would drop the second context).
 */
export function selectionKey(ids: string[]): string {
  const joined = [...ids].sort().join(',')
  let hash = 0
  for (let i = 0; i < joined.length; i++) {
    hash = (Math.imul(hash, 31) + joined.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

/**
 * Builds the chip label for a table selection, e.g. `Sales (5 rows #k3f9)` or,
 * for a cell range, `Sales (5 rows, 3 cols #k3f9)`. The trailing `key` (from
 * {@link selectionKey}) keeps distinct same-size selections from sharing a
 * label. ASCII-only for the same reason as {@link buildFileSelectionLabel}.
 */
export function buildTableSelectionLabel(
  tableName: string,
  rowCount: number,
  columnCount?: number,
  key?: string
): string {
  const rows = `${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`
  const suffix = key ? ` #${key}` : ''
  if (!columnCount) return `${tableName} (${rows}${suffix})`
  const cols = `${columnCount} ${columnCount === 1 ? 'col' : 'cols'}`
  return `${tableName} (${rows}, ${cols}${suffix})`
}

/**
 * Recovers the bare file name from a {@link buildFileSelectionLabel} label by
 * stripping the trailing ` #key` disambiguator (when present) and the
 * `:line` / `:start-end` range. Co-located with the builder so the two formats
 * can't drift apart. Used to title the resource tab (the whole file) rather than
 * the selection.
 */
export function fileNameFromSelectionLabel(label: string): string {
  return label.replace(/ #[0-9a-z]+$/, '').replace(/:\d+(?:-\d+)?$/, '')
}

/**
 * Recovers the bare table name from a {@link buildTableSelectionLabel} label by
 * stripping the trailing ` (N rows[, M cols])` suffix. Co-located with the
 * builder for the same reason as {@link fileNameFromSelectionLabel}.
 */
export function tableNameFromSelectionLabel(label: string): string {
  return label.replace(/\s*\(\d+ rows?(?:, \d+ cols?)?(?: #[0-9a-z]+)?\)$/, '')
}
