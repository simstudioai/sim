/**
 * Validation utilities for table schemas and row data.
 */

import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { COLUMN_TYPES, NAME_PATTERN, TABLE_LIMITS } from './constants'
import type { ColumnDefinition, RowData, TableSchema, ValidationResult } from './types'

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
export interface BatchRowError {
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

  const schemaValidation = validateRowAgainstSchema(rowData, schema)
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
    const uniqueColumns = getUniqueColumns(schema)
    if (uniqueColumns.length > 0) {
      const existingRows = await db
        .select({ id: userTableRows.id, data: userTableRows.data })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))

      const uniqueValidation = validateUniqueConstraints(
        rowData,
        schema,
        existingRows.map((r) => ({ id: r.id, data: r.data as RowData })),
        excludeRowId
      )

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
  }

  return { valid: true }
}

/**
 * Validates multiple rows for batch insert (size, schema, unique constraints including within batch).
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

    const schemaValidation = validateRowAgainstSchema(rowData, schema)
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
      const existingRows = await db
        .select({ id: userTableRows.id, data: userTableRows.data })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))

      for (let i = 0; i < rows.length; i++) {
        const rowData = rows[i]
        const batchRows = rows.slice(0, i).map((data, idx) => ({ id: `batch_${idx}`, data }))

        const uniqueValidation = validateUniqueConstraints(rowData, schema, [
          ...existingRows.map((r) => ({ id: r.id, data: r.data as RowData })),
          ...batchRows,
        ])

        if (!uniqueValidation.valid) {
          errors.push({ row: i, errors: uniqueValidation.errors })
        }
      }

      if (errors.length > 0) {
        return {
          valid: false,
          response: NextResponse.json(
            { error: 'Unique constraint violations in batch', details: errors },
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
    const value = data[column.name]

    if (column.required && (value === undefined || value === null)) {
      errors.push(`Missing required field: ${column.name}`)
      continue
    }

    if (value === null || value === undefined) continue

    switch (column.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`${column.name} must be string, got ${typeof value}`)
        } else if (value.length > TABLE_LIMITS.MAX_STRING_VALUE_LENGTH) {
          errors.push(`${column.name} exceeds max string length`)
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
    }
  }

  return { valid: errors.length === 0, errors }
}

/** Validates row data size is within limits. */
export function validateRowSize(data: RowData): ValidationResult {
  const size = JSON.stringify(data).length
  if (size > TABLE_LIMITS.MAX_ROW_SIZE_BYTES) {
    return {
      valid: false,
      errors: [`Row size exceeds limit (${size} bytes > ${TABLE_LIMITS.MAX_ROW_SIZE_BYTES} bytes)`],
    }
  }
  return { valid: true, errors: [] }
}

/** Returns columns with unique constraint. */
export function getUniqueColumns(schema: TableSchema): ColumnDefinition[] {
  return schema.columns.filter((col) => col.unique === true)
}

/** Validates unique constraints against existing rows. */
export function validateUniqueConstraints(
  data: RowData,
  schema: TableSchema,
  existingRows: { id: string; data: RowData }[],
  excludeRowId?: string
): ValidationResult {
  const errors: string[] = []
  const uniqueColumns = getUniqueColumns(schema)

  for (const column of uniqueColumns) {
    const value = data[column.name]
    if (value === null || value === undefined) continue

    const duplicate = existingRows.find((row) => {
      if (excludeRowId && row.id === excludeRowId) return false

      const existingValue = row.data[column.name]
      if (typeof value === 'string' && typeof existingValue === 'string') {
        return value.toLowerCase() === existingValue.toLowerCase()
      }
      return value === existingValue
    })

    if (duplicate) {
      errors.push(
        `Column "${column.name}" must be unique. Value "${value}" already exists in row ${duplicate.id}`
      )
    }
  }

  return { valid: errors.length === 0, errors }
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

  return { valid: errors.length === 0, errors }
}
