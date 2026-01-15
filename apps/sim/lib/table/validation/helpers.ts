/**
 * High-level validation helpers for table row operations.
 *
 * These helpers consolidate common validation patterns (size, schema, uniqueness)
 * into reusable functions that return formatted error responses.
 *
 * @module lib/table/validation/helpers
 */

import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type { RowData, TableSchema } from '../types'
import {
  getUniqueColumns,
  validateRowAgainstSchema,
  validateRowSize,
  validateUniqueConstraints,
} from './schema'

/**
 * Result of a successful row validation.
 */
interface ValidationSuccess {
  valid: true
}

/**
 * Result of a failed row validation with pre-formatted response.
 */
interface ValidationFailure {
  valid: false
  response: NextResponse
}

/**
 * Options for single row validation.
 */
export interface ValidateRowOptions {
  /** The row data to validate */
  rowData: RowData
  /** The table schema to validate against */
  schema: TableSchema
  /** The table ID (required for unique constraint checking) */
  tableId: string
  /** Row ID to exclude from unique checks (for updates) */
  excludeRowId?: string
  /** Whether to check unique constraints (default: true) */
  checkUnique?: boolean
}

/**
 * Validates a single row against size limits, schema, and unique constraints.
 *
 * This function consolidates the common validation pattern used across
 * insert, update, and upsert operations into a single reusable helper.
 *
 * @param options - Validation options
 * @returns Either success or a failure with pre-formatted error response
 *
 * @example
 * ```typescript
 * const result = await validateRowData({
 *   rowData: validated.data,
 *   schema: table.schema,
 *   tableId,
 *   checkUnique: true,
 * })
 *
 * if (!result.valid) return result.response
 * // Proceed with insert/update
 * ```
 */
export async function validateRowData(
  options: ValidateRowOptions
): Promise<ValidationSuccess | ValidationFailure> {
  const { rowData, schema, tableId, excludeRowId, checkUnique = true } = options

  // 1. Validate row size
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

  // 2. Validate row against schema
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

  // 3. Check unique constraints if requested
  if (checkUnique) {
    const uniqueColumns = getUniqueColumns(schema)
    if (uniqueColumns.length > 0) {
      const existingRows = await db
        .select({
          id: userTableRows.id,
          data: userTableRows.data,
        })
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
 * Error structure for batch row validation.
 */
export interface BatchRowError {
  row: number
  errors: string[]
}

/**
 * Result of a successful batch validation.
 */
interface BatchValidationSuccess {
  valid: true
}

/**
 * Result of a failed batch validation with pre-formatted response.
 */
interface BatchValidationFailure {
  valid: false
  response: NextResponse
}

/**
 * Options for batch row validation.
 */
export interface ValidateBatchRowsOptions {
  /** Array of row data to validate */
  rows: RowData[]
  /** The table schema to validate against */
  schema: TableSchema
  /** The table ID (required for unique constraint checking) */
  tableId: string
  /** Whether to check unique constraints (default: true) */
  checkUnique?: boolean
}

/**
 * Validates multiple rows for batch insert operations.
 *
 * Performs size and schema validation on all rows, then checks unique
 * constraints against both existing rows and other rows in the batch.
 *
 * @param options - Batch validation options
 * @returns Either success or a failure with pre-formatted error response
 *
 * @example
 * ```typescript
 * const result = await validateBatchRows({
 *   rows: validated.rows,
 *   schema: table.schema,
 *   tableId,
 * })
 *
 * if (!result.valid) return result.response
 * // Proceed with batch insert
 * ```
 */
export async function validateBatchRows(
  options: ValidateBatchRowsOptions
): Promise<BatchValidationSuccess | BatchValidationFailure> {
  const { rows, schema, tableId, checkUnique = true } = options
  const errors: BatchRowError[] = []

  // 1. Validate size and schema for all rows
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

  // 2. Check unique constraints if requested
  if (checkUnique) {
    const uniqueColumns = getUniqueColumns(schema)
    if (uniqueColumns.length > 0) {
      const existingRows = await db
        .select({
          id: userTableRows.id,
          data: userTableRows.data,
        })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))

      for (let i = 0; i < rows.length; i++) {
        const rowData = rows[i]

        // Check against other rows in the batch (before this one)
        const batchRows = rows.slice(0, i).map((data, idx) => ({
          id: `batch_${idx}`,
          data,
        }))

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
