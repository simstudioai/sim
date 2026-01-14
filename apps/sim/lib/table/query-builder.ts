/**
 * Query builder utilities for user-defined tables.
 *
 * Provides functions to build SQL WHERE and ORDER BY clauses for querying
 * user table rows stored as JSONB in PostgreSQL. Supports filtering on
 * JSONB fields using various operators ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $contains)
 * and sorting by both JSONB fields and built-in columns (createdAt, updatedAt).
 *
 * IMPORTANT: For equality operations ($eq and direct value), we use the JSONB
 * containment operator (@>) which can leverage the GIN index on the data column.
 * For comparison operators ($gt, $lt, etc.) and pattern matching ($contains),
 * we must use the text extraction operator (->>) which cannot use the GIN index.
 */

import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

export interface FieldCondition {
  $eq?: any
  $ne?: any
  $gt?: number
  $gte?: number
  $lt?: number
  $lte?: number
  $in?: any[]
  $nin?: any[]
  $contains?: string
}

export interface QueryFilter {
  $or?: QueryFilter[]
  $and?: QueryFilter[]
  [key: string]: any | FieldCondition | QueryFilter[] | undefined
}

/**
 * Build a JSONB containment clause that can use the GIN index.
 * Creates: data @> '{"field": value}'::jsonb
 */
function buildContainmentClause(tableName: string, field: string, value: any): SQL {
  // Build the JSONB object for containment check
  const jsonObj = JSON.stringify({ [field]: value })
  return sql`${sql.raw(`${tableName}.data`)} @> ${jsonObj}::jsonb`
}

/**
 * Build a single field condition clause
 */
function buildFieldCondition(tableName: string, field: string, condition: any): SQL[] {
  const conditions: SQL[] = []
  const escapedField = field.replace(/'/g, "''")

  if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
    // Operator-based filter
    for (const [op, value] of Object.entries(condition)) {
      switch (op) {
        case '$eq':
          conditions.push(buildContainmentClause(tableName, field, value))
          break
        case '$ne':
          conditions.push(sql`NOT (${buildContainmentClause(tableName, field, value)})`)
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
    // Direct equality
    conditions.push(buildContainmentClause(tableName, field, condition))
  }

  return conditions
}

/**
 * Build WHERE clause from filter object
 * Supports: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $contains, $or, $and
 *
 * Uses GIN-index-compatible containment operator (@>) for:
 * - $eq (equality)
 * - Direct value equality
 * - $in (as OR of containment checks)
 *
 * Uses text extraction (->>) for operators that require it:
 * - $ne (not equals - no containment equivalent)
 * - $gt, $gte, $lt, $lte (numeric comparisons)
 * - $nin (not in)
 * - $contains (pattern matching)
 *
 * Logical operators:
 * - $or: Array of filter objects, joined with OR
 * - $and: Array of filter objects, joined with AND
 */
export function buildFilterClause(filter: QueryFilter, tableName: string): SQL | undefined {
  const conditions: SQL[] = []

  for (const [field, condition] of Object.entries(filter)) {
    // Handle $or operator
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
          conditions.push(orConditions[0])
        } else {
          conditions.push(sql`(${sql.join(orConditions, sql.raw(' OR '))})`)
        }
      }
      continue
    }

    // Handle $and operator
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
          conditions.push(andConditions[0])
        } else {
          conditions.push(sql`(${sql.join(andConditions, sql.raw(' AND '))})`)
        }
      }
      continue
    }

    // Handle regular field conditions
    const fieldConditions = buildFieldCondition(tableName, field, condition)
    conditions.push(...fieldConditions)
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]

  return sql.join(conditions, sql.raw(' AND '))
}

/**
 * Build ORDER BY clause from sort object
 * Format: {field: 'asc'|'desc'}
 */
export function buildSortClause(
  sort: Record<string, 'asc' | 'desc'>,
  tableName: string
): SQL | undefined {
  const clauses: SQL[] = []

  for (const [field, direction] of Object.entries(sort)) {
    // Escape field name to prevent SQL injection
    const escapedField = field.replace(/'/g, "''")

    if (field === 'createdAt' || field === 'updatedAt') {
      // Built-in columns
      clauses.push(
        direction === 'asc'
          ? sql.raw(`${tableName}.${escapedField} ASC`)
          : sql.raw(`${tableName}.${escapedField} DESC`)
      )
    } else {
      // JSONB fields
      clauses.push(
        direction === 'asc'
          ? sql.raw(`${tableName}.data->>'${escapedField}' ASC`)
          : sql.raw(`${tableName}.data->>'${escapedField}' DESC`)
      )
    }
  }

  return clauses.length > 0 ? sql.join(clauses, sql.raw(', ')) : undefined
}
