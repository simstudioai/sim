/**
 * Query builder utilities for user-defined tables.
 *
 * Provides functions to build SQL WHERE and ORDER BY clauses for querying
 * user table rows stored as JSONB in PostgreSQL. Supports filtering on
 * JSONB fields using various operators ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $contains)
 * and sorting by both JSONB fields and built-in columns (createdAt, updatedAt).
 *
 */

import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

export interface QueryFilter {
  [key: string]:
    | any
    | {
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
}

/**
 * Build WHERE clause from filter object
 * Supports: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $contains
 */
export function buildFilterClause(filter: QueryFilter, tableName: string): SQL | undefined {
  const conditions: SQL[] = []

  for (const [field, condition] of Object.entries(filter)) {
    // Escape field name to prevent SQL injection
    const escapedField = field.replace(/'/g, "''")

    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      // Operator-based filter
      for (const [op, value] of Object.entries(condition)) {
        switch (op) {
          case '$eq':
            conditions.push(
              sql`${sql.raw(`${tableName}.data->>'${escapedField}'`)} = ${String(value)}`
            )
            break
          case '$ne':
            conditions.push(
              sql`${sql.raw(`${tableName}.data->>'${escapedField}'`)} != ${String(value)}`
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
              const valuesList = value.map((v) => String(v))
              conditions.push(
                sql`${sql.raw(`${tableName}.data->>'${escapedField}'`)} = ANY(${valuesList})`
              )
            }
            break
          case '$nin':
            if (Array.isArray(value) && value.length > 0) {
              const valuesList = value.map((v) => String(v))
              conditions.push(
                sql`${sql.raw(`${tableName}.data->>'${escapedField}'`)} != ALL(${valuesList})`
              )
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
      conditions.push(
        sql`${sql.raw(`${tableName}.data->>'${escapedField}'`)} = ${String(condition)}`
      )
    }
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
