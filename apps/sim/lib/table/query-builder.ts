/**
 * Query builder utilities for user-defined tables.
 *
 * Uses JSONB containment operator (@>) for equality to leverage GIN index.
 * Uses text extraction (->>) for comparisons and pattern matching.
 */

import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

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
  const conditions: SQL[] = []
  const escapedField = field.replace(/'/g, "''")

  if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
    for (const [op, value] of Object.entries(condition)) {
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
   * - Field names are escaped for safety.
   */
  for (const [field, direction] of Object.entries(sort)) {
    // Escape single quotes for SQL safety
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
