/**
 * Query builder utilities for user-defined tables.
 *
 * Uses JSONB containment operator (@>) for equality to leverage GIN index.
 * Uses text extraction (->>) for comparisons and pattern matching.
 */

import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { NAME_PATTERN } from './constants'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface FieldCondition {
  $eq?: JsonValue
  $ne?: JsonValue
  $gt?: number
  $gte?: number
  $lt?: number
  $lte?: number
  $in?: JsonValue[]
  $nin?: JsonValue[]
  $contains?: string
}

export interface QueryFilter {
  $or?: QueryFilter[]
  $and?: QueryFilter[]
  [key: string]: JsonValue | FieldCondition | QueryFilter[] | undefined
}

/**
 * Whitelist of allowed operators for query filtering.
 * Only these operators can be used in filter conditions.
 */
const ALLOWED_OPERATORS = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$contains',
])

/**
 * Validates a field name to prevent SQL injection.
 * Field names must match the NAME_PATTERN (alphanumeric + underscore, starting with letter/underscore).
 *
 * @param field - The field name to validate
 * @throws Error if field name is invalid
 */
function validateFieldName(field: string): void {
  if (!field || typeof field !== 'string') {
    throw new Error('Field name must be a non-empty string')
  }

  if (!NAME_PATTERN.test(field)) {
    throw new Error(
      `Invalid field name "${field}". Field names must start with a letter or underscore, followed by alphanumeric characters or underscores.`
    )
  }
}

/**
 * Validates an operator to ensure it's in the allowed list.
 *
 * @param operator - The operator to validate
 * @throws Error if operator is not allowed
 */
function validateOperator(operator: string): void {
  if (!ALLOWED_OPERATORS.has(operator)) {
    throw new Error(
      `Invalid operator "${operator}". Allowed operators: ${Array.from(ALLOWED_OPERATORS).join(', ')}`
    )
  }
}

/**
 * Builds a JSONB containment clause using GIN index.
 * Generates: `table.data @> '{"field": value}'::jsonb`
 */
function buildContainmentClause(tableName: string, field: string, value: JsonValue): SQL {
  const jsonObj = JSON.stringify({ [field]: value })
  return sql`${sql.raw(`${tableName}.data`)} @> ${jsonObj}::jsonb`
}

function buildFieldCondition(
  tableName: string,
  field: string,
  condition: JsonValue | FieldCondition
): SQL[] {
  // Validate field name to prevent SQL injection
  validateFieldName(field)

  const conditions: SQL[] = []
  const escapedField = field.replace(/'/g, "''")

  if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
    for (const [op, value] of Object.entries(condition)) {
      // Validate operator to ensure only allowed operators are used
      validateOperator(op)

      switch (op) {
        case '$eq':
          conditions.push(buildContainmentClause(tableName, field, value as JsonValue))
          break

        case '$ne':
          conditions.push(
            sql`NOT (${buildContainmentClause(tableName, field, value as JsonValue)})`
          )
          break

        case '$gt':
          conditions.push(
            sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric > ${value}`
          )
          break

        case '$gte':
          conditions.push(
            sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric >= ${value}`
          )
          break

        case '$lt':
          conditions.push(
            sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric < ${value}`
          )
          break

        case '$lte':
          conditions.push(
            sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric <= ${value}`
          )
          break

        case '$in':
          if (Array.isArray(value) && value.length > 0) {
            if (value.length === 1) {
              conditions.push(buildContainmentClause(tableName, field, value[0]))
            } else {
              const inConditions = value.map((v) => buildContainmentClause(tableName, field, v))
              conditions.push(sql`(${sql.join(inConditions, sql.raw(' OR '))})`)
            }
          }
          break

        case '$nin':
          if (Array.isArray(value) && value.length > 0) {
            const ninConditions = value.map(
              (v) => sql`NOT (${buildContainmentClause(tableName, field, v)})`
            )
            conditions.push(sql`(${sql.join(ninConditions, sql.raw(' AND '))})`)
          }
          break

        case '$contains':
          conditions.push(
            sql`${sql.raw(`${tableName}.data->>'${escapedField}'`)} ILIKE ${`%${value}%`}`
          )
          break

        default:
          // This should never happen due to validateOperator, but added for completeness
          throw new Error(`Unsupported operator: ${op}`)
      }
    }
  } else {
    conditions.push(buildContainmentClause(tableName, field, condition))
  }

  return conditions
}

/**
 * Builds a WHERE clause from a filter object.
 * Recursively processes logical operators ($or, $and) and field conditions.
 */
export function buildFilterClause(filter: QueryFilter, tableName: string): SQL | undefined {
  const conditions: SQL[] = []

  /**
   * Iterate over each field and its associated condition in the filter object.
   *
   * The filter is expected to be an object where keys are either field names or logical operators
   * ('$or', '$and'), and values are the conditions to apply or arrays of nested filter objects.
   */
  for (const [field, condition] of Object.entries(filter)) {
    // Skip undefined conditions (e.g., unused or programmatically removed filters)
    if (condition === undefined) {
      continue
    }

    /**
     * Handle the logical OR operator: { $or: [filter1, filter2, ...] }
     * Recursively build SQL clauses for each sub-filter,
     * then join them with an OR. If there is only one sub-filter,
     * no need for OR grouping.
     */
    if (field === '$or' && Array.isArray(condition)) {
      const orConditions: SQL[] = []
      for (const subFilter of condition) {
        const subClause = buildFilterClause(subFilter as QueryFilter, tableName)
        if (subClause) {
          orConditions.push(subClause)
        }
      }
      if (orConditions.length > 0) {
        if (orConditions.length === 1) {
          // Only one condition; no need to wrap in OR
          conditions.push(orConditions[0])
        } else {
          // Multiple conditions; join by OR
          conditions.push(sql`(${sql.join(orConditions, sql.raw(' OR '))})`)
        }
      }
      continue
    }

    /**
     * Handle the logical AND operator: { $and: [filter1, filter2, ...] }
     * Recursively build SQL clauses for each sub-filter,
     * then join them with an AND. If there is only one sub-filter,
     * no need for AND grouping.
     */
    if (field === '$and' && Array.isArray(condition)) {
      const andConditions: SQL[] = []
      for (const subFilter of condition) {
        const subClause = buildFilterClause(subFilter as QueryFilter, tableName)
        if (subClause) {
          andConditions.push(subClause)
        }
      }
      if (andConditions.length > 0) {
        if (andConditions.length === 1) {
          // Only one condition; no need to wrap in AND
          conditions.push(andConditions[0])
        } else {
          // Multiple conditions; join by AND
          conditions.push(sql`(${sql.join(andConditions, sql.raw(' AND '))})`)
        }
      }
      continue
    }

    /**
     * If the condition is an array, but not a logical operator,
     * skip it (invalid filter structure).
     */
    if (Array.isArray(condition)) {
      continue
    }

    /**
     * Build conditions for regular fields.
     * This delegates to buildFieldCondition, which handles comparisons like $eq, $gt, etc.
     */
    const fieldConditions = buildFieldCondition(
      tableName,
      field,
      condition as JsonValue | FieldCondition
    )
    conditions.push(...fieldConditions)
  }

  /**
   * If no conditions were built, return undefined to indicate no filter.
   * If only one condition exists, return it directly.
   * Otherwise, join all conditions using AND.
   */
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]

  return sql.join(conditions, sql.raw(' AND '))
}

/**
 * Builds an ORDER BY clause from a sort object.
 * Note: JSONB fields use text extraction, so numeric sorting may not work as expected.
 *
 * @param sort - Sort object with field names and directions
 * @param tableName - Table name for the query
 * @returns SQL ORDER BY clause or undefined if no sort specified
 * @throws Error if field name is invalid
 */
export function buildSortClause(
  sort: Record<string, 'asc' | 'desc'>,
  tableName: string
): SQL | undefined {
  const clauses: SQL[] = []

  /**
   * Build ORDER BY SQL clauses based on the sort object keys and directions.
   * - For `createdAt` and `updatedAt`, use the top-level table columns for proper type sorting.
   * - For all other fields, treat them as keys in the table's data JSONB column.
   *   Extraction is performed with ->> to return text, which is then sorted.
   * - Field names are validated to prevent SQL injection.
   */
  for (const [field, direction] of Object.entries(sort)) {
    // Validate field name to prevent SQL injection
    validateFieldName(field)

    // Validate direction
    if (direction !== 'asc' && direction !== 'desc') {
      throw new Error(`Invalid sort direction "${direction}". Must be "asc" or "desc".`)
    }

    // Escape single quotes for SQL safety (defense in depth)
    const escapedField = field.replace(/'/g, "''")

    if (field === 'createdAt' || field === 'updatedAt') {
      // Use regular column for timestamp sorting
      clauses.push(
        direction === 'asc'
          ? sql.raw(`${tableName}.${escapedField} ASC`)
          : sql.raw(`${tableName}.${escapedField} DESC`)
      )
    } else {
      // Use text extraction for JSONB field sorting
      clauses.push(
        direction === 'asc'
          ? sql.raw(`${tableName}.data->>'${escapedField}' ASC`)
          : sql.raw(`${tableName}.data->>'${escapedField}' DESC`)
      )
    }
  }

  return clauses.length > 0 ? sql.join(clauses, sql.raw(', ')) : undefined
}
