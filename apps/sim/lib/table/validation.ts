/**
 * Validation utilities for table schemas and row data.
 */

import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { and, eq, or, type SQL, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getColumnId } from '@/lib/table/column-keys'
import {
  COLUMN_TYPES,
  getMaxRowSizeBytes,
  MAX_SELECT_OPTIONS,
  NAME_PATTERN,
  SELECT_COLORS,
  type SelectColor,
  TABLE_LIMITS,
} from '@/lib/table/constants'
import { normalizeDateCellValue } from '@/lib/table/dates'
import { withSeqscanOff } from '@/lib/table/planner'
import type {
  ColumnDefinition,
  JsonValue,
  RowData,
  SelectOption,
  TableSchema,
  ValidationResult,
} from '@/lib/table/types'

export type { ColumnDefinition, TableSchema, ValidationResult }

type ValidationSuccess = { valid: true }
type ValidationFailure = { valid: false; response: NextResponse }

/** Options for validating a single row. */
export interface ValidateRowOptions {
  rowData: RowData
  schema: TableSchema
  tableId: string
  excludeRowId?: string
  checkUnique?: boolean
}

/** Error information for a single row in batch validation. */
interface BatchRowError {
  row: number
  errors: string[]
}

/** Options for validating multiple rows in batch. */
export interface ValidateBatchRowsOptions {
  rows: RowData[]
  schema: TableSchema
  tableId: string
  checkUnique?: boolean
}

/**
 * Validates a single row (size, schema, unique constraints) and returns a formatted response on failure.
 * Uses optimized database queries for unique constraint checks to avoid loading all rows into memory.
 */
export async function validateRowData(
  options: ValidateRowOptions
): Promise<ValidationSuccess | ValidationFailure> {
  const { rowData, schema, tableId, excludeRowId, checkUnique = true } = options

  const sizeValidation = validateRowSize(rowData)
  if (!sizeValidation.valid) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: 'Invalid row data', details: sizeValidation.errors },
        { status: 400 }
      ),
    }
  }

  const schemaValidation = coerceRowToSchema(rowData, schema)
  if (!schemaValidation.valid) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: 'Row data does not match schema', details: schemaValidation.errors },
        { status: 400 }
      ),
    }
  }

  if (checkUnique) {
    // Use optimized database query instead of loading all rows
    const uniqueValidation = await checkUniqueConstraintsDb(tableId, rowData, schema, excludeRowId)

    if (!uniqueValidation.valid) {
      return {
        valid: false,
        response: NextResponse.json(
          { error: 'Unique constraint violation', details: uniqueValidation.errors },
          { status: 400 }
        ),
      }
    }
  }

  return { valid: true }
}

/**
 * Validates multiple rows for batch insert (size, schema, unique constraints including within batch).
 * Uses optimized database queries for unique constraint checks to avoid loading all rows into memory.
 */
export async function validateBatchRows(
  options: ValidateBatchRowsOptions
): Promise<ValidationSuccess | ValidationFailure> {
  const { rows, schema, tableId, checkUnique = true } = options
  const errors: BatchRowError[] = []

  for (let i = 0; i < rows.length; i++) {
    const rowData = rows[i]

    const sizeValidation = validateRowSize(rowData)
    if (!sizeValidation.valid) {
      errors.push({ row: i, errors: sizeValidation.errors })
      continue
    }

    const schemaValidation = coerceRowToSchema(rowData, schema)
    if (!schemaValidation.valid) {
      errors.push({ row: i, errors: schemaValidation.errors })
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: 'Validation failed for some rows', details: errors },
        { status: 400 }
      ),
    }
  }

  if (checkUnique) {
    const uniqueColumns = getUniqueColumns(schema)
    if (uniqueColumns.length > 0) {
      // Use optimized batch unique constraint check
      const uniqueResult = await checkBatchUniqueConstraintsDb(tableId, rows, schema)

      if (!uniqueResult.valid) {
        return {
          valid: false,
          response: NextResponse.json(
            { error: 'Unique constraint violations in batch', details: uniqueResult.errors },
            { status: 400 }
          ),
        }
      }
    }
  }

  return { valid: true }
}

/** Validates table name format and length. */
export function validateTableName(name: string): ValidationResult {
  const errors: string[] = []

  if (!name || typeof name !== 'string') {
    errors.push('Table name is required')
    return { valid: false, errors }
  }

  if (name.length > TABLE_LIMITS.MAX_TABLE_NAME_LENGTH) {
    errors.push(
      `Table name exceeds maximum length (${TABLE_LIMITS.MAX_TABLE_NAME_LENGTH} characters)`
    )
  }

  if (!NAME_PATTERN.test(name)) {
    errors.push(
      'Table name must start with letter or underscore, followed by alphanumeric or underscore'
    )
  }

  return { valid: errors.length === 0, errors }
}

/** Validates table schema structure and column definitions. */
export function validateTableSchema(schema: TableSchema): ValidationResult {
  const errors: string[] = []

  if (!schema || typeof schema !== 'object') {
    errors.push('Schema is required')
    return { valid: false, errors }
  }

  if (!Array.isArray(schema.columns)) {
    errors.push('Schema must have columns array')
    return { valid: false, errors }
  }

  if (schema.columns.length === 0) {
    errors.push('Schema must have at least one column')
  }

  if (schema.columns.length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
    errors.push(`Schema exceeds maximum columns (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE})`)
  }

  for (const column of schema.columns) {
    const columnResult = validateColumnDefinition(column)
    errors.push(...columnResult.errors)
  }

  const columnNames = schema.columns.map((c) => c.name.toLowerCase())
  const uniqueNames = new Set(columnNames)
  if (uniqueNames.size !== columnNames.length) {
    errors.push('Duplicate column names found')
  }

  return { valid: errors.length === 0, errors }
}

/** Validates row data matches schema column types and required fields. */
export function validateRowAgainstSchema(data: RowData, schema: TableSchema): ValidationResult {
  const errors: string[] = []

  for (const column of schema.columns) {
    const value = data[getColumnId(column)]

    if (column.required && (value === undefined || value === null)) {
      errors.push(`Missing required field: ${column.name}`)
      continue
    }

    if (value === null || value === undefined) continue

    switch (column.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`${column.name} must be string, got ${typeof value}`)
        }
        break
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push(`${column.name} must be number`)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${column.name} must be boolean`)
        }
        break
      case 'date':
        if (
          !(value instanceof Date) &&
          (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
        ) {
          errors.push(`${column.name} must be valid date`)
        }
        break
      case 'json':
        try {
          JSON.stringify(value)
        } catch {
          errors.push(`${column.name} must be valid JSON`)
        }
        break
      case 'select':
        if (typeof value !== 'string' || !optionIds(column).has(value)) {
          errors.push(`${column.name} must be one of the defined options`)
        }
        break
      case 'multiselect': {
        if (!Array.isArray(value)) {
          errors.push(`${column.name} must be a list of options`)
        } else {
          const ids = optionIds(column)
          if (!value.every((v) => typeof v === 'string' && ids.has(v))) {
            errors.push(`${column.name} must only contain defined options`)
          } else if (column.required && value.length === 0) {
            errors.push(`Missing required field: ${column.name}`)
          }
        }
        break
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/** Set of valid option ids for a `select`/`multiselect` column. */
function optionIds(column: ColumnDefinition): Set<string> {
  return new Set((column.options ?? []).map((o) => o.id))
}

/**
 * Resolves a raw cell value to a declared option id, accepting either the
 * stable id or (tolerant for tool/import writes) the option's display name.
 * Returns null when no option matches. Exported so the column-type-conversion
 * path can gate a `select`/`multiselect` change on whether existing values
 * actually fit the target option set.
 */
export function resolveSelectOptionId(value: JsonValue, options: SelectOption[]): string | null {
  if (typeof value !== 'string') return null
  const byId = options.find((o) => o.id === value)
  if (byId) return byId.id
  const byName =
    options.find((o) => o.name === value) ??
    options.find((o) => o.name.toLowerCase() === value.toLowerCase())
  return byName ? byName.id : null
}

/**
 * Attempts to coerce a non-null value to a column's declared type. Returns the
 * coerced value when the value already matches or can be converted without
 * ambiguity (e.g. the string `"1999"` to the number `1999`), and `ok: false`
 * when no safe conversion exists.
 */
function coerceValueToColumnType(
  value: JsonValue,
  column: ColumnDefinition
): { ok: true; value: JsonValue } | { ok: false } {
  switch (column.type) {
    case 'string':
      if (typeof value === 'string') return { ok: true, value }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { ok: true, value: String(value) }
      }
      return { ok: false }
    case 'number':
      if (typeof value === 'number') {
        return Number.isFinite(value) ? { ok: true, value } : { ok: false }
      }
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false }
      }
      return { ok: false }
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true') return { ok: true, value: true }
        if (normalized === 'false') return { ok: true, value: false }
      }
      return { ok: false }
    case 'date': {
      if (typeof value === 'string') {
        const normalized = normalizeDateCellValue(value)
        return normalized === null ? { ok: false } : { ok: true, value: normalized }
      }
      // Date instances and epoch numbers may still be out of the representable
      // range (>±8.64e15ms) — guard `toISOString()`, which throws RangeError on
      // an Invalid Date, so an over-range value degrades to `{ ok: false }`
      // rather than crashing the write.
      const date =
        value instanceof Date ? value : typeof value === 'number' ? new Date(value) : null
      if (date && !Number.isNaN(date.getTime())) return { ok: true, value: date.toISOString() }
      return { ok: false }
    }
    case 'select': {
      const id = resolveSelectOptionId(value, column.options ?? [])
      return id !== null ? { ok: true, value: id } : { ok: false }
    }
    case 'multiselect': {
      const raw = Array.isArray(value) ? value : [value]
      const ids: string[] = []
      for (const entry of raw) {
        const id = resolveSelectOptionId(entry, column.options ?? [])
        if (id !== null && !ids.includes(id)) ids.push(id)
      }
      return { ok: true, value: ids }
    }
    default:
      return { ok: true, value }
  }
}

/**
 * Coerces each present value in `data` toward its column's declared type **in
 * place**. Values that already match are untouched; unambiguous conversions
 * (e.g. `"1999"` → `1999`) are applied; values that cannot be coerced are set to
 * `null` when the column is optional, or left in place when required (so a
 * subsequent {@link validateRowAgainstSchema} reports them).
 *
 * Operates per-present-column, so it is safe on a partial patch (columns absent
 * from `data` are skipped — it never invents a missing-required-field error).
 */
export function coerceRowValues(data: RowData, schema: TableSchema): void {
  for (const column of schema.columns) {
    const key = getColumnId(column)
    const value = data[key]
    if (value === null || value === undefined) continue

    const coerced = coerceValueToColumnType(value, column)
    if (coerced.ok) {
      data[key] = coerced.value
    } else if (!column.required) {
      data[key] = null
    }
  }
}

/**
 * Coerces a full row toward its schema **in place** (see {@link coerceRowValues})
 * then validates the result.
 *
 * This is the write-path entry point — callers that persist a complete row use
 * it instead of {@link validateRowAgainstSchema} so a single off-type field (a
 * tool returning `"unknown"` for a numeric column, say) nulls that one cell
 * rather than failing the entire row write. Callers persisting only a partial
 * patch should use {@link coerceRowValues} on the patch and validate the merged
 * row separately.
 */
export function coerceRowToSchema(data: RowData, schema: TableSchema): ValidationResult {
  coerceRowValues(data, schema)
  return validateRowAgainstSchema(data, schema)
}

/** Validates row data size (UTF-8 bytes of the serialized row) is within limits. */
export function validateRowSize(data: RowData): ValidationResult {
  const maxRowSizeBytes = getMaxRowSizeBytes()
  const size = Buffer.byteLength(JSON.stringify(data))
  if (size > maxRowSizeBytes) {
    return {
      valid: false,
      errors: [`Row size exceeds limit (${size} bytes > ${maxRowSizeBytes} bytes)`],
    }
  }
  return { valid: true, errors: [] }
}

/** Returns columns with unique constraint. */
export function getUniqueColumns(schema: TableSchema): ColumnDefinition[] {
  return schema.columns.filter((col) => col.unique === true)
}

/** Validates unique constraints against existing rows (in-memory version for batch validation within a batch). */
export function validateUniqueConstraints(
  data: RowData,
  schema: TableSchema,
  existingRows: { id: string; data: RowData; position?: number }[],
  excludeRowId?: string
): ValidationResult {
  const errors: string[] = []
  const uniqueColumns = getUniqueColumns(schema)

  for (const column of uniqueColumns) {
    const key = getColumnId(column)
    const value = data[key]
    if (value === null || value === undefined) continue

    const duplicate = existingRows.find((row) => {
      if (excludeRowId && row.id === excludeRowId) return false

      const existingValue = row.data[key]
      if (typeof value === 'string' && typeof existingValue === 'string') {
        return value.toLowerCase() === existingValue.toLowerCase()
      }
      return value === existingValue
    })

    if (duplicate) {
      const rowLabel =
        typeof duplicate.position === 'number' ? `row ${duplicate.position + 1}` : duplicate.id
      errors.push(
        `Column "${column.name}" must be unique. Value "${value}" already exists in ${rowLabel}`
      )
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Checks unique constraints using targeted database queries.
 * Only queries for specific conflicting values instead of loading all rows.
 * This reduces memory usage from O(n) to O(1) where n is the number of rows.
 *
 * Pass a transaction as `executor` when running inside an open tx so the
 * lookup runs on the transaction's connection and observes its uncommitted
 * writes; otherwise the default `db` connection only observes committed state.
 */
export async function checkUniqueConstraintsDb(
  tableId: string,
  data: RowData,
  schema: TableSchema,
  excludeRowId?: string,
  executor: UniqueCheckExecutor = db
): Promise<ValidationResult> {
  const errors: string[] = []
  const uniqueColumns = getUniqueColumns(schema)

  if (uniqueColumns.length === 0) {
    return { valid: true, errors: [] }
  }

  // Build conditions for each unique column value
  const conditions: Array<{ column: ColumnDefinition; value: unknown; sql: SQL }> = []

  for (const column of uniqueColumns) {
    const key = getColumnId(column)
    if (!NAME_PATTERN.test(key)) {
      throw new Error(`Invalid column id: ${key}`)
    }

    const value = data[key]
    if (value === null || value === undefined) continue

    if (typeof value === 'string') {
      conditions.push({
        column,
        value,
        sql: sql`lower(${userTableRows.data}->>${sql.raw(`'${key}'`)}) = ${value.toLowerCase()}`,
      })
    } else {
      // For other types, use direct JSONB comparison
      conditions.push({
        column,
        value,
        sql: sql`(${userTableRows.data}->${sql.raw(`'${key}'`)})::jsonb = ${JSON.stringify(value)}::jsonb`,
      })
    }
  }

  if (conditions.length === 0) {
    return { valid: true, errors: [] }
  }

  // Query for each unique column separately to provide specific error messages.
  // Tenant-bounded: `lower(data->>'col') = ...` is unestimatable, so the planner
  // otherwise seq-scans the whole shared relation per check — 3.5s on every
  // insert/edit when the value is unique (no early exit). With an external
  // transaction the flag is set on it directly — opening our own transaction
  // inside the caller's would be the nested pool checkout the migration-
  // hardening work eliminated (self-deadlock under pool exhaustion).
  const checkConditions = async (ex: UniqueCheckExecutor) => {
    for (const condition of conditions) {
      const baseCondition = and(eq(userTableRows.tableId, tableId), condition.sql)

      const whereClause = excludeRowId
        ? and(baseCondition, sql`${userTableRows.id} != ${excludeRowId}`)
        : baseCondition

      const conflictingRow = await ex
        .select({ id: userTableRows.id, position: userTableRows.position })
        .from(userTableRows)
        .where(whereClause)
        .limit(1)

      if (conflictingRow.length > 0) {
        errors.push(
          `Column "${condition.column.name}" must be unique. Value "${condition.value}" already exists in row ${conflictingRow[0].position + 1}`
        )
      }
    }
  }

  if (executor === db) {
    await withSeqscanOff(async (trx) => checkConditions(trx))
  } else {
    await executor.execute(sql`SET LOCAL enable_seqscan = off`)
    await checkConditions(executor)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Minimal executor surface needed by unique-constraint checks. Both `db` and a
 * drizzle transaction (`trx`) satisfy this, letting callers run the lookup
 * inside an open transaction so it observes uncommitted prior-batch inserts.
 */
type UniqueCheckExecutor = Pick<typeof db, 'select' | 'execute'>

/**
 * Checks unique constraints for a batch of rows using targeted database queries.
 * Validates both against existing database rows and within the batch itself.
 *
 * Pass a transaction as `executor` when running inside an open tx so the lookup
 * sees rows inserted by earlier batches in the same transaction; otherwise the
 * default `db` connection only observes committed state.
 */
export async function checkBatchUniqueConstraintsDb(
  tableId: string,
  rows: RowData[],
  schema: TableSchema,
  executor: UniqueCheckExecutor = db
): Promise<{ valid: boolean; errors: Array<{ row: number; errors: string[] }> }> {
  const uniqueColumns = getUniqueColumns(schema)
  const rowErrors: Array<{ row: number; errors: string[] }> = []

  if (uniqueColumns.length === 0) {
    return { valid: true, errors: [] }
  }

  // Build a set of all unique values for each column to check against DB.
  // Keyed by the stable column id (the row-data storage key).
  const valuesByColumn = new Map<string, { values: Set<string>; column: ColumnDefinition }>()

  for (const column of uniqueColumns) {
    valuesByColumn.set(getColumnId(column), { values: new Set(), column })
  }

  // Collect all unique values from the batch and check for duplicates within the batch
  const batchValueMap = new Map<string, Map<string, number>>() // columnId -> (normalizedValue -> firstRowIndex)

  for (const column of uniqueColumns) {
    batchValueMap.set(getColumnId(column), new Map())
  }

  for (let i = 0; i < rows.length; i++) {
    const rowData = rows[i]
    const currentRowErrors: string[] = []

    for (const column of uniqueColumns) {
      const key = getColumnId(column)
      const value = rowData[key]
      if (value === null || value === undefined) continue

      const normalizedValue =
        typeof value === 'string' ? value.toLowerCase() : JSON.stringify(value)

      // Check for duplicate within batch
      const columnValueMap = batchValueMap.get(key)!
      if (columnValueMap.has(normalizedValue)) {
        const firstRowIndex = columnValueMap.get(normalizedValue)!
        currentRowErrors.push(
          `Column "${column.name}" must be unique. Value "${value}" duplicates row ${firstRowIndex + 1} in batch`
        )
      } else {
        columnValueMap.set(normalizedValue, i)
        valuesByColumn.get(key)!.values.add(normalizedValue)
      }
    }

    if (currentRowErrors.length > 0) {
      rowErrors.push({ row: i, errors: currentRowErrors })
    }
  }

  // Now check against database for all unique values at once. Tenant-bounded
  // for the same reason as checkUniqueConstraintsDb: the lower(data->>...)
  // predicates are unestimatable and otherwise trigger whole-relation seq
  // scans. With an external transaction the flag is set on it directly (SET
  // LOCAL dies at its commit; it only penalizes plan shape, and the statements
  // that follow in those transactions are tenant-scoped writes).
  const checkColumns = async (ex: UniqueCheckExecutor) => {
    for (const [columnId, { values, column }] of valuesByColumn) {
      if (values.size === 0) continue

      if (!NAME_PATTERN.test(columnId)) {
        throw new Error(`Invalid column id: ${columnId}`)
      }

      const valueArray = Array.from(values)
      const valueConditions = valueArray.map((normalizedValue) => {
        // Check if the original values are strings (normalized values for strings are lowercase)
        // We need to determine the type from the column definition or the first row that has this value
        const isStringColumn = column.type === 'string'

        if (isStringColumn) {
          return sql`lower(${userTableRows.data}->>${sql.raw(`'${columnId}'`)}) = ${normalizedValue}`
        }
        return sql`(${userTableRows.data}->${sql.raw(`'${columnId}'`)})::jsonb = ${normalizedValue}::jsonb`
      })

      const conflictingRows = await ex
        .select({
          id: userTableRows.id,
          data: userTableRows.data,
          position: userTableRows.position,
        })
        .from(userTableRows)
        .where(and(eq(userTableRows.tableId, tableId), or(...valueConditions)))
        .limit(valueArray.length) // We only need up to one conflict per value

      // Map conflicts back to batch rows
      for (const conflict of conflictingRows) {
        const conflictData = conflict.data as RowData
        const conflictValue = conflictData[columnId]
        const normalizedConflictValue =
          typeof conflictValue === 'string'
            ? conflictValue.toLowerCase()
            : JSON.stringify(conflictValue)

        // Find which batch rows have this conflicting value
        for (let i = 0; i < rows.length; i++) {
          const rowValue = rows[i][columnId]
          if (rowValue === null || rowValue === undefined) continue

          const normalizedRowValue =
            typeof rowValue === 'string' ? rowValue.toLowerCase() : JSON.stringify(rowValue)

          if (normalizedRowValue === normalizedConflictValue) {
            // Check if this row already has errors for this column
            let rowError = rowErrors.find((e) => e.row === i)
            if (!rowError) {
              rowError = { row: i, errors: [] }
              rowErrors.push(rowError)
            }

            const errorMsg = `Column "${column.name}" must be unique. Value "${rowValue}" already exists in row ${conflict.position + 1}`
            if (!rowError.errors.includes(errorMsg)) {
              rowError.errors.push(errorMsg)
            }
          }
        }
      }
    }
  }

  if (executor === db) {
    await withSeqscanOff(async (trx) => checkColumns(trx))
  } else {
    await executor.execute(sql`SET LOCAL enable_seqscan = off`)
    await checkColumns(executor)
  }

  // Sort errors by row index
  rowErrors.sort((a, b) => a.row - b.row)

  return { valid: rowErrors.length === 0, errors: rowErrors }
}

/** Validates column definition format and type. */
export function validateColumnDefinition(column: ColumnDefinition): ValidationResult {
  const errors: string[] = []

  if (!column.name || typeof column.name !== 'string') {
    errors.push('Column name is required')
    return { valid: false, errors }
  }

  if (column.name.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
    errors.push(
      `Column name "${column.name}" exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
    )
  }

  if (!NAME_PATTERN.test(column.name)) {
    errors.push(
      `Column name "${column.name}" must start with letter or underscore, followed by alphanumeric or underscore`
    )
  }

  if (!COLUMN_TYPES.includes(column.type)) {
    errors.push(
      `Column "${column.name}" has invalid type "${column.type}". Valid types: ${COLUMN_TYPES.join(', ')}`
    )
  }

  if (column.type === 'select' || column.type === 'multiselect') {
    errors.push(...validateSelectOptions(column))
  } else if (column.options !== undefined) {
    errors.push(`Column "${column.name}" cannot define options for type "${column.type}"`)
  }

  return { valid: errors.length === 0, errors }
}

/** Validates the option set declared on a `select`/`multiselect` column. */
function validateSelectOptions(column: ColumnDefinition): string[] {
  const errors: string[] = []
  const options = column.options
  if (!Array.isArray(options) || options.length === 0) {
    errors.push(`Column "${column.name}" of type "${column.type}" must define at least one option`)
    return errors
  }
  if (options.length > MAX_SELECT_OPTIONS) {
    errors.push(`Column "${column.name}" cannot have more than ${MAX_SELECT_OPTIONS} options`)
  }
  const ids = new Set<string>()
  const names = new Set<string>()
  const validColors = new Set<SelectColor>(SELECT_COLORS)
  for (const opt of options) {
    if (!opt.id || typeof opt.id !== 'string') {
      errors.push(`Column "${column.name}" has an option missing an id`)
    } else if (ids.has(opt.id)) {
      errors.push(`Column "${column.name}" has duplicate option id "${opt.id}"`)
    } else {
      ids.add(opt.id)
    }
    if (!opt.name || typeof opt.name !== 'string') {
      errors.push(`Column "${column.name}" has an option missing a name`)
    } else {
      const key = opt.name.toLowerCase()
      if (names.has(key)) {
        errors.push(`Column "${column.name}" has duplicate option name "${opt.name}"`)
      } else {
        names.add(key)
      }
    }
    if (!validColors.has(opt.color)) {
      errors.push(`Column "${column.name}" has an option with invalid color "${opt.color}"`)
    }
  }
  return errors
}
