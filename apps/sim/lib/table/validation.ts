/**
 * Validation utilities for table schemas and row data.
 */

import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { and, eq, or, type SQL, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getColumnId } from '@/lib/table/column-keys'
import type { CoerceResult, TypeSpecificColumnKey } from '@/lib/table/column-types'
import {
  COLUMN_TYPE_REGISTRY,
  COLUMN_TYPES,
  columnTypeOf,
  isColumnType,
  TYPE_SPECIFIC_COLUMN_KEYS,
  validateColumnTypeLimits,
  validateTypeMetadata,
} from '@/lib/table/column-types'
import {
  getMaxRowSizeBytes,
  NAME_PATTERN,
  TABLE_LIMITS,
  USER_TABLE_ROWS_SQL_NAME,
} from '@/lib/table/constants'
import { withSeqscanOff } from '@/lib/table/planner'
import { resolveSelectOptionId, splitMultiSelectInput } from '@/lib/table/select-options'
import { fieldPredicate } from '@/lib/table/sql'
import type {
  ColumnDefinition,
  JsonValue,
  RowData,
  TableSchema,
  ValidationResult,
} from '@/lib/table/types'

export type { ColumnDefinition, TableSchema, ValidationResult }

/**
 * Re-exported so existing importers keep working; the implementations moved to
 * `select-options.ts` to break this module's drizzle dependency for clients.
 */
export { resolveSelectOptionId, splitMultiSelectInput }

/**
 * How each type-specific key is named when it appears on a type that doesn't
 * own it. `Record<TypeSpecificColumnKey, …>` keeps this exhaustive — a new
 * key cannot be added without giving it a message.
 */
const FOREIGN_METADATA_VERB: Record<TypeSpecificColumnKey, string> = {
  options: 'define options',
  multiple: 'be multiple',
  currencyCode: 'define a currency',
  referenceTableId: 'reference another table',
}

type ValidationSuccess = { valid: true }
type ValidationFailure = { valid: false; response: NextResponse }

/** Options for validating a single row. */
export interface ValidateRowOptions {
  rowData: RowData
  schema: TableSchema
  tableId: string
  excludeRowId?: string
  checkUnique?: boolean
  /** See {@link UncoercibleValuePolicy}. Defaults to `null` — first-party behavior. */
  uncoercibleValues?: UncoercibleValuePolicy
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
  /** See {@link UncoercibleValuePolicy}. Defaults to `null` — first-party behavior. */
  uncoercibleValues?: UncoercibleValuePolicy
}

/**
 * Validates a single row (size, schema, unique constraints) and returns a formatted response on failure.
 * Uses optimized database queries for unique constraint checks to avoid loading all rows into memory.
 */
export async function validateRowData(
  options: ValidateRowOptions
): Promise<ValidationSuccess | ValidationFailure> {
  const { rowData, schema, tableId, excludeRowId, checkUnique = true, uncoercibleValues } = options

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

  const schemaValidation = coerceRowToSchema(rowData, schema, uncoercibleValues)
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
  const { rows, schema, tableId, checkUnique = true, uncoercibleValues } = options
  const errors: BatchRowError[] = []

  for (let i = 0; i < rows.length; i++) {
    const rowData = rows[i]

    const sizeValidation = validateRowSize(rowData)
    if (!sizeValidation.valid) {
      errors.push({ row: i, errors: sizeValidation.errors })
      continue
    }

    const schemaValidation = coerceRowToSchema(rowData, schema, uncoercibleValues)
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

  errors.push(...validateColumnTypeLimits(schema.columns))

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

    const error = columnTypeOf(column).validateCell(value, column)
    if (error !== null) errors.push(error)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Attempts to coerce a non-null value to a column's declared type. Returns the
 * coerced value when the value already matches or can be converted without
 * ambiguity (e.g. the string `"1999"` to the number `1999`), and `ok: false`
 * when no safe conversion exists.
 */
function coerceValueToColumnType(value: JsonValue, column: ColumnDefinition): CoerceResult {
  return columnTypeOf(column).coerce(value, column)
}

/**
 * What a write does with a value its column's type cannot coerce.
 *
 * - `null` — blank the cell rather than fail the row. **The default**, and what
 *   every first-party surface does: the workspace grid, the internal
 *   `/api/table` routes, `/api/v1`, the Copilot table tools, the executor's
 *   Table block, CSV import, and the workflow/enrichment writers. A tool
 *   returning `"unknown"` for a numeric column nulls that one cell rather than
 *   failing the entire row write.
 * - `reject` — leave the value in place so the following
 *   {@link validateRowAgainstSchema} reports it and the write fails. Opted into
 *   by the `/api/v2` surface only, whose published contract is that a value it
 *   cannot store exactly is answered with a 400 rather than stored as `null`.
 *
 * Under `null` a value the column type can still read lossily is kept rather
 * than blanked — see `ColumnTypeDefinition.salvage`, which is why a cell naming
 * two live options and one deleted one stores the two rather than nothing. A
 * `required` column is never blanked under either policy: a null would fail the
 * required check immediately after.
 */
export type UncoercibleValuePolicy = 'reject' | 'null'

/**
 * The keys of `data` this write's caller actually supplied, for when `data` is a
 * MERGED row (stored cells overlaid with a patch) rather than the patch alone.
 * Keys outside the set are pre-existing storage, so they fall back to the `null`
 * policy whatever the caller's policy is: a legacy cell that no longer fits its
 * column was written by an earlier request, and failing this one over it refuses
 * an unrelated column's update — and, on a paged bulk job, refuses it after the
 * earlier pages have already committed. The blanking stays in the in-memory
 * copy; every merged-row caller persists only the patched keys.
 *
 * Omit it when every key in `data` is caller-supplied — a whole-row insert, or a
 * patch validated on its own.
 */
export type PatchedKeys = readonly string[]

function policyResolver(
  policy: UncoercibleValuePolicy,
  patchedKeys: PatchedKeys | undefined
): (key: string) => UncoercibleValuePolicy {
  if (patchedKeys === undefined) return () => policy
  const patched = new Set(patchedKeys)
  return (key) => (patched.has(key) ? policy : 'null')
}

/**
 * Coerces each present value in `data` toward its column's declared type **in
 * place**. Values that already match are untouched; unambiguous conversions
 * (e.g. `"1999"` → `1999`) are applied; values that cannot be coerced are
 * handled per {@link UncoercibleValuePolicy}, narrowed per key by
 * {@link PatchedKeys}.
 *
 * Operates per-present-column, so it is safe on a partial patch (columns absent
 * from `data` are skipped — it never invents a missing-required-field error).
 */
export function coerceRowValues(
  data: RowData,
  schema: TableSchema,
  policy: UncoercibleValuePolicy = 'null',
  patchedKeys?: PatchedKeys
): void {
  const policyFor = policyResolver(policy, patchedKeys)
  for (const column of schema.columns) {
    const key = getColumnId(column)
    const value = data[key]
    if (value === null || value === undefined) continue

    const coerced = coerceValueToColumnType(value, column)
    if (coerced.ok) {
      data[key] = coerced.value
      continue
    }
    if (policyFor(key) !== 'null') continue

    const salvaged = columnTypeOf(column).salvage?.(value, column)
    if (salvaged?.ok) {
      data[key] = salvaged.value
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
 * it instead of {@link validateRowAgainstSchema} so the coercion and the check
 * that follows it can never disagree about what a cell holds.
 *
 * A caller validating a MERGED row — stored cells overlaid with a patch — passes
 * the patch's keys as {@link PatchedKeys} so the strict policy applies to what
 * this request sent and not to what was already there.
 */
export function coerceRowToSchema(
  data: RowData,
  schema: TableSchema,
  policy: UncoercibleValuePolicy = 'null',
  patchedKeys?: PatchedKeys
): ValidationResult {
  coerceRowValues(data, schema, policy, patchedKeys)
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
      // Case-sensitive, matching the DB unique-check leaf (`fieldPredicate` eq).
      return value === row.data[key]
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
    const value = data[key]
    if (value === null || value === undefined) continue

    // Same leaf as the upsert conflict probe → case-sensitive JSONB containment
    // (GIN-indexed). `eq` always yields a clause for a non-null value.
    const clause = fieldPredicate(USER_TABLE_ROWS_SQL_NAME, key, 'eq', value, column)
    if (clause) conditions.push({ column, value, sql: clause })
  }

  if (conditions.length === 0) {
    return { valid: true, errors: [] }
  }

  // Query for each unique column separately to provide specific error messages.
  // The predicate is now case-sensitive JSONB containment (`data @> {...}`),
  // which can use the GIN index. We still pin `enable_seqscan = off` (tenant-
  // bounded) defensively for the small-table / cold-stats case. With an external
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

      const normalizedValue = JSON.stringify(value)

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
        // Reconstruct the original typed value from its normalized key. Both
        // directions go through JSON unconditionally: keying the write on the
        // value's RUNTIME type while keying the read on the column's DECLARED
        // type made them disagree for any non-`string` type that stores a
        // string — a unique `date` column normalized to a bare `2024-01-01`
        // and then threw `SyntaxError` trying to parse it back.
        const originalValue: JsonValue = JSON.parse(normalizedValue)
        // Same case-sensitive containment leaf as every other matcher.
        const clause = fieldPredicate(
          USER_TABLE_ROWS_SQL_NAME,
          columnId,
          'eq',
          originalValue,
          column
        )
        if (!clause) {
          throw new Error(`Failed to build unique-constraint predicate for column "${column.name}"`)
        }
        return clause
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
          typeof conflictValue === 'string' ? conflictValue : JSON.stringify(conflictValue)

        // Find which batch rows have this conflicting value
        for (let i = 0; i < rows.length; i++) {
          const rowValue = rows[i][columnId]
          if (rowValue === null || rowValue === undefined) continue

          const normalizedRowValue =
            typeof rowValue === 'string' ? rowValue : JSON.stringify(rowValue)

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

  if (!isColumnType(column.type)) {
    errors.push(
      `Column "${column.name}" has invalid type "${column.type}". Valid types: ${COLUMN_TYPES.join(', ')}`
    )
    // Every check below reads the type's own rules; without a known type there
    // are none to apply.
    return { valid: false, errors }
  }

  const definition = COLUMN_TYPE_REGISTRY[column.type]
  errors.push(...validateTypeMetadata(column))

  // Uniqueness compares the stored value, which is meaningless for a type whose
  // storage is an opaque id — it would cap each option at one row for the whole
  // table, and the UI hides the toggle so it could never be cleared again.
  if (column.unique && !definition.supportsUnique) {
    errors.push(`Column "${column.name}" of type "${column.type}" cannot be unique`)
  }

  // Type-specific metadata stored on the wrong type is inert until a later
  // conversion inherits it — silently overriding what that request asked for.
  const owned = new Set<string>(definition.ownedMetadata)
  for (const key of TYPE_SPECIFIC_COLUMN_KEYS) {
    if (column[key] === undefined || owned.has(key)) continue
    errors.push(
      `Column "${column.name}" cannot ${FOREIGN_METADATA_VERB[key]} for type "${column.type}"`
    )
  }

  return { valid: errors.length === 0, errors }
}
