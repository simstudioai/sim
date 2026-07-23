/**
 * Shared CSV import helpers for user-defined tables.
 *
 * Used by:
 * - `POST /api/table/import-csv` (create new table from CSV — streams via {@link createCsvParser})
 * - `POST /api/table/[tableId]/import` (append/replace into existing table)
 * - Copilot `user-table` tool (`create_from_file`, `import_file` — buffers via {@link parseCsvBuffer})
 *
 * Keeping a single implementation avoids drift between HTTP and agent code paths.
 * Both the buffered ({@link parseCsvBuffer}) and streaming ({@link createCsvParser})
 * parsers share {@link csvParseOptions} so their behavior can't drift.
 */

import { type Options as CsvParseOptions, type Parser, parse as parseCsvStream } from 'csv-parse'
import { getColumnId } from '@/lib/table/column-keys'
import { type NormalizeDateCellOptions, normalizeDateCellValue } from '@/lib/table/dates'
import type { ColumnDefinition, RowData, TableSchema } from '@/lib/table/types'

/**
 * Field separators we sniff for, in tie-break priority order. Semicolon files are
 * the standard CSV export of European-locale Excel; pipe shows up in log exports.
 */
export const CSV_DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const

export type CsvDelimiter = (typeof CSV_DELIMITER_CANDIDATES)[number]

/**
 * Bytes inspected when sniffing the delimiter. Read from the head of the file on
 * every path (client preview, streamed upload, background worker) so all of them
 * observe the same prefix and therefore agree on the result.
 */
export const CSV_DELIMITER_SNIFF_BYTES = 64 * 1024

/**
 * Single source of truth for the `csv-parse` options used by both the buffered
 * sync parser and the streaming parser.
 *
 * `columns` is a function rather than `true` so the *actual header row* is
 * captured. With `relax_column_count`, a record shorter than the header simply
 * omits the trailing keys, so `Object.keys(records[0])` under-reports the schema
 * whenever the first data row is ragged — the header callback is authoritative.
 */
export function csvParseOptions(
  delimiter = ',',
  onHeaders?: (headers: string[]) => void
): CsvParseOptions {
  return {
    columns: (header: string[]) => {
      // Deliver headers deduped to match the record keys: csv-parse collapses duplicate
      // column names into a single object key (last value wins), so the consumer's schema
      // inference and mapping must see the same unique set — not the raw duplicates, which
      // would invent phantom columns that never receive a value. csv-parse still keys on the
      // raw array we return here, so returning it unchanged preserves that collapsing.
      onHeaders?.(dedupeHeaders(header))
      return header
    },
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true,
    cast: false,
    bom: true,
    delimiter,
  }
}

/**
 * Returns a streaming `csv-parse` parser (a `Transform`/async-iterable). Pipe a
 * file stream into it and iterate records with `for await`; backpressure flows
 * back to the source while each record is processed. Use this for HTTP uploads
 * so the file is never fully buffered in memory.
 *
 * `onHeaders` fires once, before the first record, with the full header row.
 */
export function createCsvParser(delimiter = ',', onHeaders?: (headers: string[]) => void): Parser {
  return parseCsvStream(csvParseOptions(delimiter, onHeaders))
}

/**
 * Drops later exact-duplicate header names, preserving first-occurrence order. Mirrors how
 * `csv-parse` collapses duplicate column names into a single record key (last value wins), so
 * the header set stays in lockstep with the object keys the parser actually emits.
 */
export function dedupeHeaders(headers: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const header of headers) {
    if (seen.has(header)) continue
    seen.add(header)
    unique.push(header)
  }
  return unique
}

/** Decodes CSV bytes as UTF-8, passing strings through unchanged. */
export function decodeCsvText(input: Buffer | Uint8Array | string): string {
  if (typeof input === 'string') return input
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return input.toString('utf-8')
  return new TextDecoder('utf-8').decode(input as Uint8Array)
}

/**
 * Sniffs the field separator by trial-parsing the sample with each candidate and
 * keeping the one whose column count is most *consistent* across rows.
 *
 * A real parse (rather than counting raw characters) is what makes this safe on
 * files whose quoted cells contain other candidates — `alarms.csv` exports a
 * semicolon-separated file whose `raw_text` cells are full of commas and
 * newlines, and a naive frequency count picks the comma.
 *
 * Each candidate is scored `modalWidth × consistency` — the modal (most common)
 * row width times the fraction of rows at that width. This balances the two
 * failure modes: ranking on width alone lets a delimiter that merely widens the
 * header win (a comma splitting a semicolon file's unquoted header), while
 * ranking on consistency alone lets a separator that appears uniformly *inside*
 * values win over a real delimiter whose rows are legitimately ragged (a pipe
 * embedded once per row beating a semicolon that yields 2- and 3-column rows).
 * The product rewards a split that is both wide and uniform; ties break toward
 * the wider split, then toward candidate order. Using the modal width (not the
 * first row's) keeps one stray ragged row from distorting the score, and a
 * single-column file (no candidate reaches two columns) falls back to `fallback`.
 *
 * Files that stay exactly tied on both score and width are genuinely ambiguous —
 * e.g. `name;value,unit` splits into two columns under either `;` or `,` — so the
 * global-default candidate order (comma first) decides, and both readings still
 * produce a valid table.
 *
 * All callers funnel through here, so the sample is prepared identically for
 * every import path: a possibly-partial trailing line (from slicing a fixed byte
 * window out of a larger file) is dropped before parsing so a mid-record cut
 * can't skew the counts.
 */
export async function detectCsvDelimiter(
  input: Buffer | Uint8Array | string,
  fallback: CsvDelimiter = ','
): Promise<CsvDelimiter> {
  const { parse } = await import('csv-parse/sync')
  const decoded = decodeCsvText(input)
  // Drop a partial final line when the sample is a prefix of a larger file; keep the
  // whole thing when it's a single line (no newline) so a tiny full file still parses.
  const lastNewline = decoded.lastIndexOf('\n')
  const text = lastNewline > 0 ? decoded.slice(0, lastNewline + 1) : decoded
  if (text.trim() === '') return fallback

  let best: { delimiter: CsvDelimiter; fields: number; score: number } | null = null

  for (const delimiter of CSV_DELIMITER_CANDIDATES) {
    let records: string[][]
    try {
      records = parse(text, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        skip_records_with_error: true,
        bom: true,
        delimiter,
      }) as string[][]
    } catch {
      continue
    }

    if (records.length === 0) continue

    // Modal row width: the most frequent column count, tie-broken toward the wider one.
    const widthCounts = new Map<number, number>()
    for (const record of records) {
      widthCounts.set(record.length, (widthCounts.get(record.length) ?? 0) + 1)
    }
    let fields = 0
    let modalFreq = 0
    for (const [width, freq] of widthCounts) {
      if (freq > modalFreq || (freq === modalFreq && width > fields)) {
        fields = width
        modalFreq = freq
      }
    }
    if (fields < 2) continue

    // Reward a split that is both wide and uniform; ties break toward the wider split.
    const score = fields * (modalFreq / records.length)

    if (!best || score > best.score || (score === best.score && fields > best.fields)) {
      best = { delimiter, fields, score }
    }
  }

  return best?.delimiter ?? fallback
}

/** Narrower type than `COLUMN_TYPES` used internally for coercion. */
export type CsvColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json'

/** Number of CSV rows sampled when inferring column types for a new table. */
export const CSV_SCHEMA_SAMPLE_SIZE = 100

/**
 * Maximum rows inserted per import batch. Each batch is one `INSERT … VALUES` statement, and
 * Postgres caps bind parameters at 65,535 — at 9 params per row that's a hard ceiling of ~7,200
 * rows, so 5,000 keeps a margin while cutting per-batch overhead (validation, unique-constraint
 * check, ownership heartbeat) 5× vs the old 1,000.
 */
export const CSV_MAX_BATCH_SIZE = 5000

/** Maximum CSV/TSV file size accepted by import routes (25 MB). */
export const CSV_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

/**
 * Error thrown when the user-supplied mapping or CSV does not line up with the
 * target table. Callers should translate this into a 400 response.
 */
export class CsvImportValidationError extends Error {
  readonly code = 'CSV_IMPORT_VALIDATION' as const
  readonly details: {
    missingRequired?: string[]
    duplicateTargets?: string[]
    unknownColumns?: string[]
    unknownHeaders?: string[]
  }

  constructor(
    message: string,
    details: {
      missingRequired?: string[]
      duplicateTargets?: string[]
      unknownColumns?: string[]
      unknownHeaders?: string[]
    } = {}
  ) {
    super(message)
    this.name = 'CsvImportValidationError'
    this.details = details
  }
}

/**
 * Parses a CSV/TSV payload using `csv-parse/sync`. Accepts a Node `Buffer`,
 * browser-friendly `Uint8Array`, or already-decoded string. A leading UTF-8 BOM
 * is stripped by csv-parse (`bom: true` in {@link csvParseOptions}).
 *
 * For HTTP uploads prefer {@link createCsvParser} so the file isn't buffered.
 */
export async function parseCsvBuffer(
  input: Buffer | Uint8Array | string,
  delimiter = ','
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const { parse } = await import('csv-parse/sync')

  const text = decodeCsvText(input)

  let headers: string[] = []
  // double-cast-allowed: shared csvParseOptions() loses the `columns` literal that drives
  // csv-parse's record-vs-string[][] overload, but `columns` is always set so records are objects
  const parsed = parse(
    text,
    csvParseOptions(delimiter, (h) => {
      headers = h
    })
  ) as unknown as Record<string, unknown>[]

  if (parsed.length === 0) {
    throw new Error('CSV file has no data rows')
  }

  if (headers.length === 0) {
    throw new Error('CSV file has no headers')
  }

  return { headers, rows: parsed }
}

/**
 * Infers a column type from a sample of non-empty values. Order matters: we
 * prefer narrower types (number > boolean > ISO date) and fall back to string.
 * JSON is never inferred automatically.
 */
export function inferColumnType(values: unknown[]): Exclude<CsvColumnType, 'json'> {
  const nonEmpty = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (nonEmpty.length === 0) return 'string'

  const allNumber = nonEmpty.every((v) => {
    const n = Number(v)
    return !Number.isNaN(n) && String(v).trim() !== ''
  })
  if (allNumber) return 'number'

  const allBoolean = nonEmpty.every((v) => {
    const s = String(v).toLowerCase()
    return s === 'true' || s === 'false'
  })
  if (allBoolean) return 'boolean'

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/
  const allDate = nonEmpty.every((v) => {
    const s = String(v)
    return isoDatePattern.test(s) && !Number.isNaN(Date.parse(s))
  })
  if (allDate) return 'date'

  return 'string'
}

/**
 * Sanitizes a raw header into a valid column/table name. Strips disallowed
 * characters, collapses runs of underscores, and ensures the first character
 * is a letter or underscore (prefixing with `fallbackPrefix` otherwise).
 */
export function sanitizeName(raw: string, fallbackPrefix = 'col'): string {
  let name = raw
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!name || /^\d/.test(name)) {
    name = `${fallbackPrefix}_${name}`
  }

  return name
}

/**
 * Returns column definitions inferred from CSV headers + sample rows. Duplicate
 * sanitized names are suffixed with `_2`, `_3`, etc. Also returns the header ->
 * column-name mapping used when coercing row values.
 */
export function inferSchemaFromCsv(
  headers: string[],
  rows: Record<string, unknown>[]
): { columns: ColumnDefinition[]; headerToColumn: Map<string, string> } {
  const sample = rows.slice(0, CSV_SCHEMA_SAMPLE_SIZE)
  const seen = new Set<string>()
  const headerToColumn = new Map<string, string>()

  const columns = headers.map((header) => {
    const base = sanitizeName(header)
    let colName = base
    let suffix = 2
    while (seen.has(colName.toLowerCase())) {
      colName = `${base}_${suffix}`
      suffix++
    }
    seen.add(colName.toLowerCase())
    headerToColumn.set(header, colName)

    return {
      name: colName,
      type: inferColumnType(sample.map((r) => r[header])),
    } satisfies ColumnDefinition
  })

  return { columns, headerToColumn }
}

/**
 * Coerces a single value to the requested column type. Returns `null` for
 * empty inputs or values that cannot be parsed (numbers/booleans). Dates fall
 * back to the original string when unparseable so that schema validation can
 * reject it with context rather than silently inserting `null`.
 */
export function coerceValue(
  value: unknown,
  colType: CsvColumnType,
  options?: NormalizeDateCellOptions
): string | number | boolean | null | Record<string, unknown> | unknown[] {
  if (value === null || value === undefined || value === '') return null
  switch (colType) {
    case 'number': {
      const n = Number(value)
      return Number.isNaN(n) ? null : n
    }
    case 'boolean': {
      const s = String(value).toLowerCase()
      if (s === 'true') return true
      if (s === 'false') return false
      return null
    }
    case 'date': {
      return normalizeDateCellValue(String(value), options) ?? String(value)
    }
    case 'json': {
      if (typeof value === 'object') return value as Record<string, unknown> | unknown[]
      try {
        return JSON.parse(String(value))
      } catch {
        return String(value)
      }
    }
    default:
      return String(value)
  }
}

/**
 * Mapping from raw CSV header to target column name, with `null` indicating
 * "do not import this column".
 */
export type CsvHeaderMapping = Record<string, string | null>

export interface CsvMappingValidationResult {
  /** Columns present in the CSV that landed on a real table column. */
  mappedHeaders: string[]
  /** Columns in the CSV that the user/client chose to skip. */
  skippedHeaders: string[]
  /** Target column names that ended up unmapped (resolved from the mapping). */
  unmappedColumns: string[]
  /** Effective header -> column map (after dropping unknown / null targets). */
  effectiveMap: Map<string, string>
}

/**
 * Validates a user-supplied mapping against the target table schema. Rejects
 * unknown target columns, duplicate targets, and required table columns that
 * are not covered by the CSV. Returns the normalized header -> column map.
 */
export function validateMapping(params: {
  csvHeaders: string[]
  mapping: CsvHeaderMapping
  tableSchema: TableSchema
}): CsvMappingValidationResult {
  const { csvHeaders, mapping, tableSchema } = params
  const columnByName = new Map(tableSchema.columns.map((c) => [c.name, c]))

  const unknownHeaders = Object.keys(mapping).filter((h) => !csvHeaders.includes(h))
  if (unknownHeaders.length > 0) {
    throw new CsvImportValidationError(
      `Mapping references unknown CSV headers: ${unknownHeaders.join(', ')}`,
      { unknownHeaders }
    )
  }

  const invalidTargets = Object.entries(mapping).filter(
    ([, target]) => target !== null && typeof target !== 'string'
  )
  if (invalidTargets.length > 0) {
    throw new CsvImportValidationError(
      `Mapping values must be a column name (string) or null, got: ${invalidTargets
        .map(([header]) => header)
        .join(', ')}`
    )
  }

  const targetsSeen = new Map<string, string[]>()
  const unknownColumns: string[] = []
  const effectiveMap = new Map<string, string>()
  const skippedHeaders: string[] = []

  for (const header of csvHeaders) {
    const target = header in mapping ? mapping[header] : undefined
    if (target === null || target === undefined) {
      skippedHeaders.push(header)
      continue
    }
    if (!columnByName.has(target)) {
      unknownColumns.push(target)
      continue
    }
    const existing = targetsSeen.get(target) ?? []
    existing.push(header)
    targetsSeen.set(target, existing)
    effectiveMap.set(header, target)
  }

  if (unknownColumns.length > 0) {
    throw new CsvImportValidationError(
      `Mapping references columns that do not exist on the table: ${unknownColumns.join(', ')}`,
      { unknownColumns }
    )
  }

  const duplicateTargets = [...targetsSeen.entries()]
    .filter(([, headers]) => headers.length > 1)
    .map(([col]) => col)
  if (duplicateTargets.length > 0) {
    throw new CsvImportValidationError(
      `Multiple CSV headers map to the same column(s): ${duplicateTargets.join(', ')}`,
      { duplicateTargets }
    )
  }

  const mappedTargets = new Set(effectiveMap.values())
  const unmappedColumns = tableSchema.columns
    .filter((c) => !mappedTargets.has(c.name))
    .map((c) => c.name)

  const missingRequired = tableSchema.columns
    .filter((c) => c.required && !mappedTargets.has(c.name))
    .map((c) => c.name)
  if (missingRequired.length > 0) {
    throw new CsvImportValidationError(
      `CSV is missing required columns: ${missingRequired.join(', ')}`,
      { missingRequired }
    )
  }

  return {
    mappedHeaders: [...effectiveMap.keys()],
    skippedHeaders,
    unmappedColumns,
    effectiveMap,
  }
}

/**
 * Builds an auto-mapping from CSV headers to table columns: prefers exact
 * sanitized-name matches and falls back to a case- and punctuation-insensitive
 * comparison. Unmapped headers are set to `null`.
 */
export function buildAutoMapping(csvHeaders: string[], tableSchema: TableSchema): CsvHeaderMapping {
  const mapping: CsvHeaderMapping = {}
  const columns = tableSchema.columns

  const exactByName = new Map(columns.map((c) => [c.name, c.name]))
  const loose = new Map<string, string>()
  for (const col of columns) {
    loose.set(col.name.toLowerCase().replace(/[^a-z0-9]/g, ''), col.name)
  }

  const usedTargets = new Set<string>()

  for (const header of csvHeaders) {
    const sanitized = sanitizeName(header)
    const exact = exactByName.get(sanitized)
    if (exact && !usedTargets.has(exact)) {
      mapping[header] = exact
      usedTargets.add(exact)
      continue
    }
    const key = header.toLowerCase().replace(/[^a-z0-9]/g, '')
    const fuzzy = loose.get(key)
    if (fuzzy && !usedTargets.has(fuzzy)) {
      mapping[header] = fuzzy
      usedTargets.add(fuzzy)
      continue
    }
    mapping[header] = null
  }

  return mapping
}

/**
 * Coerces parsed CSV rows into `RowData` objects keyed by the target column's
 * **stable id** (the row-data storage key), applying the column types declared in
 * `tableSchema`. Headers not present in `headerToColumn` are dropped. Missing
 * table columns remain unset (schema validation decides whether that's
 * acceptable). Pass the schema returned by `createTable` so ids are resolved.
 */
export function coerceRowsForTable(
  rows: Record<string, unknown>[],
  tableSchema: TableSchema,
  headerToColumn: Map<string, string>,
  options?: NormalizeDateCellOptions
): RowData[] {
  const colByName = new Map(tableSchema.columns.map((c) => [c.name, c]))

  return rows.map((row) => {
    const coerced: RowData = {}
    for (const [header, value] of Object.entries(row)) {
      const colName = headerToColumn.get(header)
      if (!colName) continue
      const col = colByName.get(colName)
      if (!col) continue
      const colType = (col.type as CsvColumnType) ?? 'string'
      coerced[getColumnId(col)] = coerceValue(value, colType, options) as RowData[string]
    }
    return coerced
  })
}

/**
 * Sanitizes raw JSON keys so they conform to the same column-name rules as CSV
 * headers, letting `inferSchemaFromCsv` and `coerceRowsForTable` be reused for
 * JSON imports. Collisions after sanitization are disambiguated with a trailing
 * underscore. Returns the headers and rows untouched when no key needs renaming.
 */
export function sanitizeJsonHeaders(
  headers: string[],
  rows: Record<string, unknown>[]
): { headers: string[]; rows: Record<string, unknown>[] } {
  const renamed = new Map<string, string>()
  const seen = new Set<string>()

  for (const raw of headers) {
    let safe = sanitizeName(raw)
    while (seen.has(safe)) safe = `${safe}_`
    seen.add(safe)
    renamed.set(raw, safe)
  }

  const noChange = headers.every((h) => renamed.get(h) === h)
  if (noChange) return { headers, rows }

  return {
    headers: headers.map((h) => renamed.get(h)!),
    rows: rows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [raw, safe] of renamed) {
        if (raw in row) out[safe] = row[raw]
      }
      return out
    }),
  }
}

/**
 * Parses a JSON payload that must be an array of plain objects into the same
 * `{ headers, rows }` shape produced by `parseCsvBuffer`. The header set is the
 * union of all object keys, sanitized via {@link sanitizeJsonHeaders}.
 */
export function parseJsonRows(buffer: Buffer | string): {
  headers: string[]
  rows: Record<string, unknown>[]
} {
  const text = typeof buffer === 'string' ? buffer : buffer.toString('utf-8')
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) {
    throw new Error('JSON file must contain an array of objects')
  }
  if (parsed.length === 0) {
    throw new Error('JSON file contains an empty array')
  }
  const headerSet = new Set<string>()
  for (const row of parsed) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new Error('Each element in the JSON array must be a plain object')
    }
    for (const key of Object.keys(row)) headerSet.add(key)
  }
  return sanitizeJsonHeaders([...headerSet], parsed)
}

/**
 * Parses a tabular upload (CSV, TSV, or JSON array-of-objects) into a uniform
 * `{ headers, rows }` shape, dispatching on file extension and falling back to
 * the MIME content type. Throws on unsupported formats so callers fail fast.
 */
export async function parseFileRows(
  buffer: Buffer,
  fileName: string,
  contentType?: string
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'json' || contentType === 'application/json') {
    return parseJsonRows(buffer)
  }
  if (ext === 'csv' || ext === 'tsv' || contentType === 'text/csv') {
    const delimiter = await detectCsvDelimiter(
      buffer.subarray(0, CSV_DELIMITER_SNIFF_BYTES),
      ext === 'tsv' ? '\t' : ','
    )
    return parseCsvBuffer(buffer, delimiter)
  }
  throw new Error(`Unsupported file format: "${ext ?? fileName}". Supported: csv, tsv, json`)
}
