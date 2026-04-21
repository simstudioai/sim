/**
 * Shared CSV import helpers for user-defined tables.
 *
 * Used by:
 * - `POST /api/table/import-csv` (create new table from CSV)
 * - `POST /api/table/[tableId]/import-csv` (append/replace into existing table)
 * - Copilot `user-table` tool (`create_from_file`, `import_file`)
 *
 * Keeping a single implementation avoids drift between HTTP and agent code paths.
 */

import type { ColumnDefinition, RowData, TableSchema } from '@/lib/table/types'

/** Narrower type than `COLUMN_TYPES` used internally for coercion. */
export type CsvColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json'

/** Number of CSV rows sampled when inferring column types for a new table. */
export const CSV_SCHEMA_SAMPLE_SIZE = 100

/** Maximum rows inserted per `batchInsertRows` call during import. */
export const CSV_MAX_BATCH_SIZE = 1000

/** Maximum CSV/TSV file size accepted by import routes (50 MB). */
export const CSV_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

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
 * browser-friendly `Uint8Array`, or already-decoded string. Strips a leading
 * UTF-8 BOM so headers are not silently prefixed with `\uFEFF`.
 */
export async function parseCsvBuffer(
  input: Buffer | Uint8Array | string,
  delimiter = ','
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const { parse } = await import('csv-parse/sync')

  let text: string
  if (typeof input === 'string') {
    text = input
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    text = input.toString('utf-8')
  } else {
    text = new TextDecoder('utf-8').decode(input as Uint8Array)
  }
  text = text.replace(/^\uFEFF/, '')

  const parsed = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true,
    cast: false,
    delimiter,
  }) as Record<string, unknown>[]

  if (parsed.length === 0) {
    throw new Error('CSV file has no data rows')
  }

  const headers = Object.keys(parsed[0])
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
  colType: CsvColumnType
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
      const d = new Date(String(value))
      return Number.isNaN(d.getTime()) ? String(value) : d.toISOString()
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
 * Coerces parsed CSV rows into `RowData` objects keyed by target column name,
 * applying the column types declared in `tableSchema`. Headers not present in
 * `headerToColumn` are dropped. Missing table columns remain unset (schema
 * validation decides whether that's acceptable).
 */
export function coerceRowsForTable(
  rows: Record<string, unknown>[],
  tableSchema: TableSchema,
  headerToColumn: Map<string, string>
): RowData[] {
  const typeByName = new Map(tableSchema.columns.map((c) => [c.name, c.type as CsvColumnType]))

  return rows.map((row) => {
    const coerced: RowData = {}
    for (const [header, value] of Object.entries(row)) {
      const colName = headerToColumn.get(header)
      if (!colName) continue
      const colType = typeByName.get(colName) ?? 'string'
      coerced[colName] = coerceValue(value, colType) as RowData[string]
    }
    return coerced
  })
}
