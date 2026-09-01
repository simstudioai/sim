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

/**
 * Max characters of rendered markdown a `table_selection` contributes to the
 * prompt. Row and column caps alone don't bound this — 500 rows of wide cells
 * dwarf a file selection — so the renderer spends this budget and reports what
 * it dropped. Deliberately equal to {@link MAX_FILE_SELECTION_TEXT_LENGTH} so
 * both selection kinds cost the prompt the same at worst.
 */
export const MAX_TABLE_SELECTION_CONTENT_LENGTH = MAX_FILE_SELECTION_TEXT_LENGTH

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
 * Keeps only public web URLs in browser-selection source metadata: http/https
 * with no embedded credentials. The URL is advisory context, so anything else
 * is dropped (undefined) rather than rejecting the selection. Shared by the
 * chat request schema and the server-side context formatter — the latter is
 * also reached via /api/mothership/execute, which bypasses the schema, so the
 * predicate must hold in both places.
 */
export function safeBrowserSelectionUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return undefined
    }
    return parsed.href
  } catch {
    return undefined
  }
}

/**
 * Builds the IDE-style chip label for a file selection, e.g. `notes.md:12-40` or
 * `notes.md:12`. Without a line range — the rich-markdown editor, whose document
 * model has no source lines — it falls back to `notes.md (selection)`.
 *
 * That suffix is load-bearing, not decoration: a bare file name would be
 * identical to the whole-file `@notes.md` chip's label, and menu-driven inserts
 * reject any context whose label is already taken (`isContextAlreadySelected`).
 * A markdown selection would then silently block mentioning its own file.
 *
 * Kept ASCII so the label survives being inserted as an inline mention token in
 * the chat input. Labels must be unique across a message's chips — the caller
 * resolves collisions through `uniqueContextLabel`.
 */
export function buildFileSelectionLabel(
  fileName: string,
  startLine?: number,
  endLine?: number
): string {
  if (!startLine) return `${fileName} (selection)`
  const range = endLine && endLine !== startLine ? `${startLine}-${endLine}` : `${startLine}`
  return `${fileName}:${range}`
}

/**
 * Builds the chip label for a table selection, e.g. `Sales (5 rows)` or, for a
 * cell range, `Sales (5 rows, 3 cols)`. ASCII-only, and collision-resolved by
 * the caller, for the same reasons as {@link buildFileSelectionLabel}.
 */
export function buildTableSelectionLabel(
  tableName: string,
  rowCount: number,
  columnCount?: number
): string {
  const rows = `${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`
  if (!columnCount) return `${tableName} (${rows})`
  const cols = `${columnCount} ${columnCount === 1 ? 'col' : 'cols'}`
  return `${tableName} (${rows}, ${cols})`
}
