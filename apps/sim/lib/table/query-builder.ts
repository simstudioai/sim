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

/**
 * JSON-serializable value types.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * Field condition operators for filtering.
 */
export interface FieldCondition {
  /** Equality */
  $eq?: JsonValue
  /** Not equal */
  $ne?: JsonValue
  /** Greater than */
  $gt?: number
  /** Greater than or equal */
  $gte?: number
  /** Less than */
  $lt?: number
  /** Less than or equal */
  $lte?: number
  /** Value in array */
  $in?: JsonValue[]
  /** Value not in array */
  $nin?: JsonValue[]
  /** String contains (case-insensitive) */
  $contains?: string
}

/**
 * Query filter object supporting logical operators and field conditions.
 */
export interface QueryFilter {
  /** OR conditions */
  $or?: QueryFilter[]
  /** AND conditions */
  $and?: QueryFilter[]
  /** Field conditions keyed by column name */
  [key: string]: JsonValue | FieldCondition | QueryFilter[] | undefined
}

/**
 * Builds a JSONB containment clause that can use the GIN index.
 *
 * The containment operator (@>) checks if the left JSONB value contains the right JSONB value.
 * This is efficient because PostgreSQL can use a GIN index on the data column.
 *
 * Example: For field "age" with value 25, generates:
 *   `table.data @> '{"age": 25}'::jsonb`
 *
 * This is equivalent to: WHERE data->>'age' = '25' but can use the GIN index.
 *
 * @param tableName - The table alias/name (e.g., "user_tables")
 * @param field - The field name within the JSONB data column
 * @param value - The value to check for containment
 * @returns SQL clause for containment check
 */
function buildContainmentClause(tableName: string, field: string, value: JsonValue): SQL {
  // Build the JSONB object for containment check
  // Example: { "age": 25 } becomes '{"age":25}'::jsonb
  const jsonObj = JSON.stringify({ [field]: value })
  return sql`${sql.raw(`${tableName}.data`)} @> ${jsonObj}::jsonb`
}

/**
 * Builds SQL conditions for a single field.
 *
 * This function handles two types of conditions:
 * 1. Direct value equality: `{ age: 25 }` -> uses containment operator (@>)
 * 2. Operator-based: `{ age: { $gt: 25 } }` -> uses text extraction (->>) for comparisons
 *
 * The function returns an array because some operators (like $in) generate multiple conditions.
 *
 * @param tableName - The table alias/name
 * @param field - The field name within the JSONB data column
 * @param condition - Either a direct value (JsonValue) or an operator object (FieldCondition)
 * @returns Array of SQL conditions (usually one, but can be multiple for $in/$nin)
 */
function buildFieldCondition(
  tableName: string,
  field: string,
  condition: JsonValue | FieldCondition
): SQL[] {
  const conditions: SQL[] = []
  // Escape single quotes in field name to prevent SQL injection
  // Example: "O'Brien" -> "O''Brien"
  const escapedField = field.replace(/'/g, "''")

  // Check if condition is an operator object (e.g., { $gt: 25 })
  if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
    // Operator-based filter: iterate through operators like $eq, $gt, etc.
    for (const [op, value] of Object.entries(condition)) {
      switch (op) {
        case '$eq':
          // Equality: uses containment operator for GIN index support
          // Example: { age: { $eq: 25 } } -> data @> '{"age": 25}'::jsonb
          conditions.push(buildContainmentClause(tableName, field, value as JsonValue))
          break

        case '$ne':
          // Not equal: negation of containment
          // Example: { age: { $ne: 25 } } -> NOT (data @> '{"age": 25}'::jsonb)
          conditions.push(
            sql`NOT (${buildContainmentClause(tableName, field, value as JsonValue)})`
          )
          break

        case '$gt':
          // Greater than: must use text extraction (->>) and cast to numeric
          // Cannot use containment operator for comparisons
          // Example: { age: { $gt: 25 } } -> (data->>'age')::numeric > 25
          conditions.push(
            sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric > ${value}`
          )
          break

        case '$gte':
          // Greater than or equal
          // Example: { age: { $gte: 25 } } -> (data->>'age')::numeric >= 25
          conditions.push(
            sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric >= ${value}`
          )
          break

        case '$lt':
          // Less than
          // Example: { age: { $lt: 25 } } -> (data->>'age')::numeric < 25
          conditions.push(
            sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric < ${value}`
          )
          break

        case '$lte':
          // Less than or equal
          // Example: { age: { $lte: 25 } } -> (data->>'age')::numeric <= 25
          conditions.push(
            sql`(${sql.raw(`${tableName}.data->>'${escapedField}'`)})::numeric <= ${value}`
          )
          break

        case '$in':
          // Value in array: converts to OR of containment checks
          // Example: { age: { $in: [25, 30, 35] } }
          //   -> (data @> '{"age": 25}'::jsonb OR data @> '{"age": 30}'::jsonb OR data @> '{"age": 35}'::jsonb)
          if (Array.isArray(value) && value.length > 0) {
            if (value.length === 1) {
              // Single value: just use containment directly
              conditions.push(buildContainmentClause(tableName, field, value[0]))
            } else {
              // Multiple values: create OR chain of containment checks
              const inConditions = value.map((v) => buildContainmentClause(tableName, field, v))
              conditions.push(sql`(${sql.join(inConditions, sql.raw(' OR '))})`)
            }
          }
          break

        case '$nin':
          // Value not in array: converts to AND of negated containment checks
          // Example: { age: { $nin: [25, 30] } }
          //   -> (NOT (data @> '{"age": 25}'::jsonb) AND NOT (data @> '{"age": 30}'::jsonb))
          if (Array.isArray(value) && value.length > 0) {
            const ninConditions = value.map(
              (v) => sql`NOT (${buildContainmentClause(tableName, field, v)})`
            )
            conditions.push(sql`(${sql.join(ninConditions, sql.raw(' AND '))})`)
          }
          break

        case '$contains':
          // String contains: uses ILIKE for case-insensitive pattern matching
          // Example: { name: { $contains: "john" } } -> data->>'name' ILIKE '%john%'
          // Note: This cannot use the GIN index, so it's slower on large datasets
          conditions.push(
            sql`${sql.raw(`${tableName}.data->>'${escapedField}'`)} ILIKE ${`%${value}%`}`
          )
          break
      }
    }
  } else {
    // Direct equality: condition is a primitive value (string, number, boolean, null)
    // Example: { age: 25 } -> data @> '{"age": 25}'::jsonb
    // This uses the containment operator for optimal performance with GIN index
    conditions.push(buildContainmentClause(tableName, field, condition))
  }

  return conditions
}

/**
 * Builds a WHERE clause from a filter object.
 *
 * This is the main entry point for converting a QueryFilter object into SQL.
 * It recursively processes the filter, handling logical operators ($or, $and) and
 * field conditions.
 *
 * Examples:
 * 1. Simple filter: `{ age: 25, name: "John" }`
 *    -> `(data @> '{"age": 25}'::jsonb) AND (data @> '{"name": "John"}'::jsonb)`
 *
 * 2. With operators: `{ age: { $gt: 25 }, name: { $contains: "john" } }`
 *    -> `((data->>'age')::numeric > 25) AND (data->>'name' ILIKE '%john%')`
 *
 * 3. With $or: `{ $or: [{ age: 25 }, { age: 30 }] }`
 *    -> `((data @> '{"age": 25}'::jsonb) OR (data @> '{"age": 30}'::jsonb))`
 *
 * Performance notes:
 * - Uses GIN-index-compatible containment operator (@>) for: $eq, direct equality, $in
 * - Uses text extraction (->>) for: $ne, $gt, $gte, $lt, $lte, $nin, $contains
 * - Text extraction cannot use GIN index, so those queries are slower
 *
 * @param filter - The filter object to convert to SQL
 * @param tableName - The table alias/name (e.g., "user_tables")
 * @returns SQL WHERE clause or undefined if filter is empty
 */
export function buildFilterClause(filter: QueryFilter, tableName: string): SQL | undefined {
  const conditions: SQL[] = []

  // Iterate through all fields in the filter object
  for (const [field, condition] of Object.entries(filter)) {
    // Skip undefined conditions (can happen with optional fields)
    if (condition === undefined) {
      continue
    }

    // Handle $or operator: creates OR group of sub-filters
    // Example: { $or: [{ age: 25 }, { name: "John" }] }
    //   -> (age condition) OR (name condition)
    if (field === '$or' && Array.isArray(condition)) {
      const orConditions: SQL[] = []
      // Recursively process each sub-filter in the OR array
      for (const subFilter of condition) {
        const subClause = buildFilterClause(subFilter as QueryFilter, tableName)
        if (subClause) {
          orConditions.push(subClause)
        }
      }
      // Only add OR group if we have at least one condition
      if (orConditions.length > 0) {
        if (orConditions.length === 1) {
          // Single condition: no need for parentheses
          conditions.push(orConditions[0])
        } else {
          // Multiple conditions: wrap in parentheses and join with OR
          conditions.push(sql`(${sql.join(orConditions, sql.raw(' OR '))})`)
        }
      }
      continue
    }

    // Handle $and operator: creates AND group of sub-filters
    // Example: { $and: [{ age: { $gt: 25 } }, { name: { $contains: "john" } }] }
    //   -> (age condition) AND (name condition)
    if (field === '$and' && Array.isArray(condition)) {
      const andConditions: SQL[] = []
      // Recursively process each sub-filter in the AND array
      for (const subFilter of condition) {
        const subClause = buildFilterClause(subFilter as QueryFilter, tableName)
        if (subClause) {
          andConditions.push(subClause)
        }
      }
      // Only add AND group if we have at least one condition
      if (andConditions.length > 0) {
        if (andConditions.length === 1) {
          // Single condition: no need for parentheses
          conditions.push(andConditions[0])
        } else {
          // Multiple conditions: wrap in parentheses and join with AND
          conditions.push(sql`(${sql.join(andConditions, sql.raw(' AND '))})`)
        }
      }
      continue
    }

    // Handle regular field conditions (not $or or $and)
    // This processes fields like "age", "name", etc. with their conditions
    // Skip if condition is QueryFilter[] (shouldn't happen for regular fields)
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

  // Return undefined if no conditions were generated
  if (conditions.length === 0) return undefined

  // If only one condition, return it directly (no need to join)
  if (conditions.length === 1) return conditions[0]

  // Multiple conditions: join with AND (default behavior)
  // Example: { age: 25, name: "John" } -> condition1 AND condition2
  return sql.join(conditions, sql.raw(' AND '))
}

/**
 * Builds an ORDER BY clause from a sort object.
 *
 * Supports sorting by:
 * 1. Built-in columns: createdAt, updatedAt (direct column access)
 * 2. JSONB fields: any field in the data column (uses text extraction)
 *
 * Examples:
 * - `{ createdAt: 'desc' }` -> `table.createdAt DESC`
 * - `{ age: 'asc', name: 'desc' }` -> `table.data->>'age' ASC, table.data->>'name' DESC`
 *
 * Note: Sorting by JSONB fields uses text extraction (->>), which means:
 * - Numbers are sorted as strings (e.g., "10" < "2")
 * - No index can be used, so sorting is slower on large datasets
 *
 * @param sort - Sort object with field names as keys and 'asc'|'desc' as values
 * @param tableName - The table alias/name (e.g., "user_tables")
 * @returns SQL ORDER BY clause or undefined if no sort specified
 */
export function buildSortClause(
  sort: Record<string, 'asc' | 'desc'>,
  tableName: string
): SQL | undefined {
  const clauses: SQL[] = []

  // Process each field in the sort object
  for (const [field, direction] of Object.entries(sort)) {
    // Escape single quotes in field name to prevent SQL injection
    // Example: "O'Brien" -> "O''Brien"
    const escapedField = field.replace(/'/g, "''")

    // Check if this is a built-in column (createdAt, updatedAt)
    // These are actual columns in the table, not JSONB fields
    if (field === 'createdAt' || field === 'updatedAt') {
      // Built-in columns: direct column access
      // Example: { createdAt: 'desc' } -> table.createdAt DESC
      clauses.push(
        direction === 'asc'
          ? sql.raw(`${tableName}.${escapedField} ASC`)
          : sql.raw(`${tableName}.${escapedField} DESC`)
      )
    } else {
      // JSONB fields: use text extraction operator (->>)
      // Example: { age: 'asc' } -> table.data->>'age' ASC
      // Note: This extracts the value as text, so numeric sorting may not work as expected
      clauses.push(
        direction === 'asc'
          ? sql.raw(`${tableName}.data->>'${escapedField}' ASC`)
          : sql.raw(`${tableName}.data->>'${escapedField}' DESC`)
      )
    }
  }

  // Join multiple sort fields with commas
  // Example: { age: 'asc', name: 'desc' } -> "age ASC, name DESC"
  return clauses.length > 0 ? sql.join(clauses, sql.raw(', ')) : undefined
}
