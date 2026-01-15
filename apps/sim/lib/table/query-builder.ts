/**
 * Query builder utilities for user-defined tables.
 *
 * Uses JSONB containment operator (@>) for equality to leverage GIN index.
 * Uses text extraction (->>) for comparisons and pattern matching.
 */

import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { NAME_PATTERN } from './constants'
import type { FilterOperators, JsonValue, QueryFilter } from './types'

/**
 * Field condition is an alias for FilterOperators.
 * @deprecated Use FilterOperators from types.ts instead.
 */
export type FieldCondition = FilterOperators

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

/**
 * Builds a numeric comparison clause for JSONB fields.
 * Generates: `(table.data->>'field')::numeric <operator> value`
 */
function buildComparisonClause(
  tableName: string,
  field: string,
  operator: '>' | '>=' | '<' | '<=',
  value: number
): SQL {
  const escapedField = field.replace(/'/g, "''")
  return sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric ${sql.raw(operator)} ${value}`
}

/**
 * Builds a case-insensitive pattern matching clause for JSONB text fields.
 * Generates: `table.data->>'field' ILIKE '%value%'`
 */
function buildContainsClause(tableName: string, field: string, value: string): SQL {
  const escapedField = field.replace(/'/g, "''")
  return sql`${sql.raw(`${tableName}.data->>'${escapedField}'`)} ILIKE ${`%${value}%`}`
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
 * @param condition - Either a simple value (for equality) or a FieldCondition
 *                    object with operators like $eq, $gt, $in, etc.
 * @returns Array of SQL condition fragments. Multiple conditions are returned
 *          when the condition object contains multiple operators.
 * @throws Error if field name is invalid or operator is not allowed
 */
function buildFieldCondition(
  tableName: string,
  field: string,
  condition: JsonValue | FieldCondition
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
    conditions.push(buildContainmentClause(tableName, field, condition))
  }

  return conditions
}

/**
 * Builds SQL clauses from nested filters and joins them with the specified operator.
 */
function buildLogicalClause(
  subFilters: QueryFilter[],
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

/**
 * Builds a WHERE clause from a filter object.
 * Recursively processes logical operators ($or, $and) and field conditions.
 */
export function buildFilterClause(filter: QueryFilter, tableName: string): SQL | undefined {
  const conditions: SQL[] = []

  for (const [field, condition] of Object.entries(filter)) {
    if (condition === undefined) {
      continue
    }

    if (field === '$or' && Array.isArray(condition)) {
      const orClause = buildLogicalClause(condition as QueryFilter[], tableName, 'OR')
      if (orClause) {
        conditions.push(orClause)
      }
      continue
    }

    if (field === '$and' && Array.isArray(condition)) {
      const andClause = buildLogicalClause(condition as QueryFilter[], tableName, 'AND')
      if (andClause) {
        conditions.push(andClause)
      }
      continue
    }

    if (Array.isArray(condition)) {
      continue
    }

    const fieldConditions = buildFieldCondition(
      tableName,
      field,
      condition as JsonValue | FieldCondition
    )
    conditions.push(...fieldConditions)
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]

  return sql.join(conditions, sql.raw(' AND '))
}

/**
 * Builds a single ORDER BY clause for a field.
 * Timestamp fields use direct column access, others use JSONB text extraction.
 */
function buildSortFieldClause(tableName: string, field: string, direction: 'asc' | 'desc'): SQL {
  const escapedField = field.replace(/'/g, "''")
  const directionSql = direction.toUpperCase()

  if (field === 'createdAt' || field === 'updatedAt') {
    return sql.raw(`${tableName}.${escapedField} ${directionSql}`)
  }

  return sql.raw(`${tableName}.data->>'${escapedField}' ${directionSql}`)
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

  for (const [field, direction] of Object.entries(sort)) {
    validateFieldName(field)

    if (direction !== 'asc' && direction !== 'desc') {
      throw new Error(`Invalid sort direction "${direction}". Must be "asc" or "desc".`)
    }

    clauses.push(buildSortFieldClause(tableName, field, direction))
  }

  return clauses.length > 0 ? sql.join(clauses, sql.raw(', ')) : undefined
}
