/**
 * A table's rows as source, opted into by its declaration's `rows`: `tables/<key>.rows.jsonl`
 * holds one JSON object per line, each a row keyed by column key (a select cell holds option
 * names). `seed` rows are written once, into a table the apply creates (or adopts empty);
 * `managed` rows are the table's whole content, matched to stored rows by the `key` column.
 *
 * ```ts
 * export default defineTable({
 *   name: 'plans',
 *   columns: { code: column.string({ required: true, unique: true }), seats: column.number() },
 *   rows: { mode: 'managed', key: 'code' },
 * })
 * ```
 *
 * Only managed rows are fingerprinted, and apart from the table's declaration
 * ({@link tableRowsFingerprint}): telling whether stored rows drifted means reading them, which a
 * plan does only when the directory's rows changed. A stored row whose key cell is empty (the
 * table's "add row" makes one) has nothing a line could match it by, so it is not managed: it is
 * printed and fingerprinted by neither side, and an apply never writes or removes it.
 */

import { isRecordLike } from '@sim/utils/object'
import { utf8ByteLength } from '@sim/utils/paste'
import { compareStrings } from '@sim/utils/string'
import type { Json } from '@sim/workflow-code'
import type { ResourceFingerprint } from '../base'
import {
  diagnostic,
  findingLimitReached,
  MAX_FINDINGS_PER_FILE,
  resourceOf,
  type WorkspaceDiagnostic,
  wholeFile,
} from '../diagnostics'
import { fingerprintOf } from '../fingerprint'
import { KIND_DIRS } from '../kind'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'

/** The rows file of a table, beside its `tables/<key>.ts`. */
export const TABLE_ROWS_EXTENSION = '.rows.jsonl'

/** How a table's rows are part of source. */
export const TABLE_ROWS_MODES = ['seed', 'managed'] as const

/** `seed`: written into a new (or empty adopted) table only; `managed`: the table's rows. */
type TableRowsMode = (typeof TABLE_ROWS_MODES)[number]

/** One row, keyed by column key; an absent column is an empty cell. */
export type TableRowCells = Record<string, Json>

/** A declaration's `rows`, with the rows its file holds. */
export interface TableRowsDecl {
  mode: TableRowsMode
  /** The column key that identifies a managed row: a unique column every row fills. */
  key?: string
  /** The rows of `tables/<key>.rows.jsonl`, in file order; empty without the file. */
  data: TableRowCells[]
}

/** The rows file of table `key`. */
export function tableRowsPath(key: string): string {
  return `${KIND_DIRS.table}/${key}${TABLE_ROWS_EXTENSION}`
}

/** The text a managed row is matched by: its key cell, case folded as a unique column compares. */
export function rowKeyText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.toLowerCase()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** Whether a managed row holds a value in its key column, so a rows file can name it. */
export function hasRowKey(row: TableRowCells, rowKey: string): boolean {
  return rowKeyText(row[rowKey]) !== undefined
}

/** The UTF-8 bytes `row` takes as one line of a rows file, its newline included. */
export function printedRowBytes(row: TableRowCells): number {
  return utf8ByteLength(JSON.stringify(filledCells(row))) + 1
}

/** A row without its empty cells (null, `''` and `[]`, which a table stores as no value). */
function filledCells(row: TableRowCells): TableRowCells {
  const cells: TableRowCells = {}
  for (const [column, value] of Object.entries(row)) {
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue
    cells[column] = value
  }
  return cells
}

/** Line span of `[start, end)` on 1-based `line` of `file`. */
function lineSpan(file: string, line: number, start: number, end: number) {
  return { file, line, column: 1, endLine: line, endColumn: end - start + 1, start, end }
}

/**
 * Reads `tables/<key>.rows.jsonl` for `rows`, against the declared column keys: every line a JSON
 * object of declared columns, at most `maxTableRows`, and for managed rows each with a key value
 * no other row holds. Blank lines are skipped. `lines` holds each row's 1-based line.
 */
export function parseTableRows(
  key: string,
  text: string,
  rows: Omit<TableRowsDecl, 'data'>,
  columns: ReadonlySet<string>
): { data: TableRowCells[]; lines: number[]; diagnostics: WorkspaceDiagnostic[] } {
  const file = tableRowsPath(key)
  const diagnostics: WorkspaceDiagnostic[] = []
  const resource = resourceOf('table', key)
  const report = (message: string, span = wholeFile(file), hint?: string) =>
    diagnostics.push(
      diagnostic('E_TABLE_ROWS', message, {
        ...resource,
        span,
        ...(hint ? { hint } : {}),
      })
    )
  const data: TableRowCells[] = []
  const rowLines: number[] = []
  const seen = new Map<string, number>()
  let offset = 0
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const start = offset
    offset += line.length + 1
    if (line.trim() === '') continue
    if (diagnostics.length >= MAX_FINDINGS_PER_FILE) {
      diagnostics.push(findingLimitReached({ ...resource, span: wholeFile(file) }))
      break
    }
    const span = lineSpan(file, index + 1, start, start + line.length)
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      report(`Line ${index + 1} is not JSON.`, span, 'Each line holds one row as a JSON object.')
      continue
    }
    if (!isRecordLike(value) || Array.isArray(value)) {
      report(`Line ${index + 1} is not a JSON object.`, span)
      continue
    }
    const row = value as TableRowCells
    const unknown = Object.keys(row).filter((column) => !columns.has(column))
    if (unknown.length > 0) {
      report(
        `Line ${index + 1} names ${unknown.map((column) => `"${column}"`).join(', ')}, which the table does not declare.`,
        span,
        'A row is keyed by the column keys of `columns`.'
      )
      continue
    }
    if (rows.mode === 'managed' && rows.key !== undefined) {
      const rowKey = rowKeyText(row[rows.key])
      if (rowKey === undefined) {
        report(
          `Line ${index + 1} has no "${rows.key}": a managed row is matched by its key column.`,
          span
        )
        continue
      }
      const previous = seen.get(rowKey)
      if (previous !== undefined) {
        report(`Lines ${previous} and ${index + 1} share the key "${String(row[rows.key])}".`, span)
        continue
      }
      seen.set(rowKey, index + 1)
    }
    data.push(row)
    rowLines.push(index + 1)
  }
  if (data.length > WORKSPACE_SOURCE_LIMITS.maxTableRows) {
    report(
      `The file holds ${data.length} rows; a table's rows file holds at most ${WORKSPACE_SOURCE_LIMITS.maxTableRows}.`
    )
  }
  return { data, lines: rowLines, diagnostics }
}

/**
 * Managed rows in canonical order: by key, each without its empty cells, so a reordered file or a
 * `null` written for an absent cell reads as the same rows. A row without a key is left out.
 */
function sortedRows(data: readonly TableRowCells[], rowKey: string): TableRowCells[] {
  return data
    .filter((row) => hasRowKey(row, rowKey))
    .map(filledCells)
    .sort((a, b) => compareStrings(rowKeyText(a[rowKey]) ?? '', rowKeyText(b[rowKey]) ?? ''))
}

/** Prints rows as `parseTableRows` reads them: one line per row, cells in `columnOrder`. */
export function printTableRows(
  rows: TableRowsDecl,
  columnOrder: readonly string[]
): string | undefined {
  const ordered = rows.mode === 'managed' && rows.key ? sortedRows(rows.data, rows.key) : rows.data
  if (ordered.length === 0) return undefined
  const lines = ordered.map((row) => {
    const cells = filledCells(row)
    const printed: TableRowCells = {}
    for (const column of columnOrder) {
      if (Object.hasOwn(cells, column)) printed[column] = cells[column]
    }
    return JSON.stringify(printed)
  })
  return `${lines.join('\n')}\n`
}

/**
 * The fingerprint of a table's managed rows, which the base records apart from the table's: `null`
 * for a table whose rows are not managed.
 */
export function tableRowsFingerprint(rows: TableRowsDecl | undefined): ResourceFingerprint | null {
  if (rows?.mode !== 'managed' || rows.key === undefined) return null
  return fingerprintOf({ key: rows.key, rows: sortedRows(rows.data, rows.key) })
}
