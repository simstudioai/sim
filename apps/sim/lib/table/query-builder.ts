/**
 * Query builder utilities for user-defined tables.
 *
 * Uses JSONB containment operator (@>) for equality to leverage GIN index.
 * Uses text extraction (->>) for comparisons and pattern matching.
 */

import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { NAME_PATTERN } from './constants'
import type { ColumnDefinition, ConditionOperators, Filter, JsonValue, Sort } from './types'

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
 * Builds a WHERE clause from a filter object.
 * Recursively processes logical operators ($or, $and) and field conditions.
 *
 * @param filter - Filter object with field conditions and logical operators
 * @param tableName - Table name for the query (e.g., 'user_table_rows')
 * @returns SQL WHERE clause or undefined if no filter specified
 * @throws Error if field name is invalid or operator is not allowed
 *
 * @example
 * // Simple equality
 * buildFilterClause({ name: 'John' }, 'user_table_rows')
 *
 * // Complex filter with operators
 * buildFilterClause({ age: { $gte: 18 }, status: { $in: ['active', 'pending'] } }, 'user_table_rows')
 *
 * // Logical operators
 * buildFilterClause({ $or: [{ status: 'active' }, { verified: true }] }, 'user_table_rows')
 */
export function buildFilterClause(filter: Filter, tableName: string): SQL | undefined {
  const conditions: SQL[] = []

  for (const [field, condition] of Object.entries(filter)) {
    if (condition === undefined) {
      continue
    }

    // This represents a case where the filter is a logical OR of multiple filters
    // e.g. { $or: [{ status: 'active' }, { status: 'pending' }] }
    if (field === '$or' && Array.isArray(condition)) {
      const orClause = buildLogicalClause(condition as Filter[], tableName, 'OR')
      if (orClause) {
        conditions.push(orClause)
      }
      continue
    }

    // This represents a case where the filter is a logical AND of multiple filters
    // e.g. { $and: [{ status: 'active' }, { status: 'pending' }] }
    if (field === '$and' && Array.isArray(condition)) {
      const andClause = buildLogicalClause(condition as Filter[], tableName, 'AND')
      if (andClause) {
        conditions.push(andClause)
      }
      continue
    }

    // Skip arrays for regular fields - arrays are only valid for $or and $and.
    // If we encounter an array here, it's likely malformed input (e.g., { name: [filter1, filter2] })
    // which doesn't have a clear semantic meaning, so we skip it.
    if (Array.isArray(condition)) {
      continue
    }

    // Build SQL conditions for this field. Returns array of SQL fragments for each operator.
    const fieldConditions = buildFieldCondition(
      tableName,
      field,
      condition as JsonValue | ConditionOperators
    )
    conditions.push(...fieldConditions)
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]

  return sql.join(conditions, sql.raw(' AND '))
}

/**
 * Builds an ORDER BY clause from a sort object.
 *
 * @param sort - Sort object with field names and directions
 * @param tableName - Table name for the query (e.g., 'user_table_rows')
 * @param columns - Optional column definitions for type-aware sorting
 * @returns SQL ORDER BY clause or undefined if no sort specified
 * @throws Error if field name is invalid
 *
 * @example
 * buildSortClause({ name: 'asc', age: 'desc' }, 'user_table_rows')
 * // Returns: ORDER BY data->>'name' ASC, data->>'age' DESC
 *
 * @example
 * // With column types for proper numeric sorting
 * buildSortClause({ salary: 'desc' }, 'user_table_rows', [{ name: 'salary', type: 'number' }])
 * // Returns: ORDER BY (data->>'salary')::numeric DESC NULLS LAST
 */
export function buildSortClause(
  sort: Sort,
  tableName: string,
  columns?: ColumnDefinition[]
): SQL | undefined {
  const clauses: SQL[] = []
  const columnTypeMap = new Map(columns?.map((col) => [col.name, col.type]))

  for (const [field, direction] of Object.entries(sort)) {
    validateFieldName(field)

    if (direction !== 'asc' && direction !== 'desc') {
      throw new Error(`Invalid sort direction "${direction}". Must be "asc" or "desc".`)
    }

    const columnType = columnTypeMap.get(field)
    clauses.push(buildSortFieldClause(tableName, field, direction, columnType))
  }

  return clauses.length > 0 ? sql.join(clauses, sql.raw(', ')) : undefined
}

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
 * Builds SQL conditions for a single field based on the provided condition.
 *
 * Supports both simple equality checks (using JSONB containment) and complex
 * operators like comparison, membership, and pattern matching. Field names are
 * validated to prevent SQL injection, and operators are validated against an
 * allowed whitelist.
 *
 * @param tableName - The name of the table to query (used for SQL table reference)
 * @param field - The field name to filter on (must match NAME_PATTERN)
 * @param condition - Either a simple value (for equality) or a ConditionOperators
 *                    object with operators like $eq, $gt, $in, etc.
 * @returns Array of SQL condition fragments. Multiple conditions are returned
 *          when the condition object contains multiple operators.
 * @throws Error if field name is invalid or operator is not allowed
 */
function buildFieldCondition(
  tableName: string,
  field: string,
  condition: JsonValue | ConditionOperators
): SQL[] {
  validateFieldName(field)

  const conditions: SQL[] = []

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
          conditions.push(buildComparisonClause(tableName, field, '>', value as number))
          break

        case '$gte':
          conditions.push(buildComparisonClause(tableName, field, '>=', value as number))
          break

        case '$lt':
          conditions.push(buildComparisonClause(tableName, field, '<', value as number))
          break

        case '$lte':
          conditions.push(buildComparisonClause(tableName, field, '<=', value as number))
          break

        case '$in':
          if (Array.isArray(value) && value.length > 0) {
            if (value.length === 1) {
              // Single value then use containment clause
              conditions.push(buildContainmentClause(tableName, field, value[0]))
            } else {
              // Multiple values then use OR clause
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
          conditions.push(buildContainsClause(tableName, field, value as string))
          break

        default:
          // This should never happen due to validateOperator, but added for completeness
          throw new Error(`Unsupported operator: ${op}`)
      }
    }
  } else {
    // Simple value (primitive or null) - shorthand for equality.
    // Example: { name: 'John' } is equivalent to { name: { $eq: 'John' } }
    conditions.push(buildContainmentClause(tableName, field, condition))
  }

  return conditions
}

/**
 * Builds SQL clauses from nested filters and joins them with the specified operator.
 *
 * @example
 * // OR operator
 * buildLogicalClause(
 *   [{ status: 'active' }, { status: 'pending' }],
 *   'user_table_rows',
 *   'OR'
 * )
 * // Returns: (data @> '{"status":"active"}'::jsonb OR data @> '{"status":"pending"}'::jsonb)
 *
 * @example
 * // AND operator
 * buildLogicalClause(
 *   [{ age: { $gte: 18 } }, { verified: true }],
 *   'user_table_rows',
 *   'AND'
 * )
 * // Returns: ((data->>'age')::numeric >= 18 AND data @> '{"verified":true}'::jsonb)
 */
function buildLogicalClause(
  subFilters: Filter[],
  tableName: string,
  operator: 'OR' | 'AND'
): SQL | undefined {
  const clauses: SQL[] = []
  for (const subFilter of subFilters) {
    const clause = buildFilterClause(subFilter, tableName)
    if (clause) {
      clauses.push(clause)
    }
  }

  if (clauses.length === 0) return undefined
  if (clauses.length === 1) return clauses[0]

  return sql`(${sql.join(clauses, sql.raw(` ${operator} `))})`
}

/** Builds JSONB containment clause: `data @> '{"field": value}'::jsonb` (uses GIN index) */
function buildContainmentClause(tableName: string, field: string, value: JsonValue): SQL {
  const jsonObj = JSON.stringify({ [field]: value })
  return sql`${sql.raw(`${tableName}.data`)} @> ${jsonObj}::jsonb`
}

/** Builds numeric comparison: `(data->>'field')::numeric <op> value` (cannot use GIN index) */
function buildComparisonClause(
  tableName: string,
  field: string,
  operator: '>' | '>=' | '<' | '<=',
  value: number
): SQL {
  const escapedField = field.replace(/'/g, "''")
  return sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric ${sql.raw(operator)} ${value}`
}

/** Builds case-insensitive pattern match: `data->>'field' ILIKE '%value%'` */
function buildContainsClause(tableName: string, field: string, value: string): SQL {
  const escapedField = field.replace(/'/g, "''")
  return sql`${sql.raw(`${tableName}.data->>'${escapedField}'`)} ILIKE ${`%${value}%`}`
}

/**
 * Builds a single ORDER BY clause for a field.
 * Timestamp fields use direct column access, others use JSONB text extraction.
 * Numeric and date columns are cast to appropriate types for correct sorting.
 *
 * @param tableName - The table name
 * @param field - The field name to sort by
 * @param direction - Sort direction ('asc' or 'desc')
 * @param columnType - Optional column type for type-aware sorting
 */
function buildSortFieldClause(
  tableName: string,
  field: string,
  direction: 'asc' | 'desc',
  columnType?: string
): SQL {
  const escapedField = field.replace(/'/g, "''")
  const directionSql = direction.toUpperCase()

  if (field === 'createdAt' || field === 'updatedAt') {
    return sql.raw(`${tableName}.${escapedField} ${directionSql}`)
  }

  const jsonbExtract = `${tableName}.data->>'${escapedField}'`

  // Cast to appropriate type for correct sorting
  if (columnType === 'number') {
    // Cast to numeric, with NULLS LAST to handle null/invalid values
    return sql.raw(`(${jsonbExtract})::numeric ${directionSql} NULLS LAST`)
  }

  if (columnType === 'date') {
    // Cast to timestamp for chronological sorting
    return sql.raw(`(${jsonbExtract})::timestamp ${directionSql} NULLS LAST`)
  }

  // Default: sort as text (for string, boolean, json, or unknown types)
  return sql.raw(`${jsonbExtract} ${directionSql}`)
}
