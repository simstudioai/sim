/**
 * SQL query builder utilities for user-defined tables.
 *
 * Uses JSONB containment operator (@>) for equality to leverage GIN index.
 * Uses text extraction (->>) for comparisons and pattern matching.
 */

import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { NAME_PATTERN } from './constants'
import type { ColumnDefinition, ConditionOperators, Filter, JsonValue, Sort } from './types'

/**
 * Error thrown when caller-supplied filter or sort input is malformed.
 * Routes should map this to HTTP 400 with the message preserved.
 */
export class TableQueryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TableQueryValidationError'
  }
}

type ColumnType = ColumnDefinition['type']
type ColumnTypeMap = ReadonlyMap<string, ColumnType>

/**
 * Returns the Postgres cast needed to compare a JSONB text value of the given
 * column type, or `null` when text comparison is correct. Single source of
 * truth for both filter range operators and sort ordering — keeps the two
 * paths from drifting apart.
 */
function jsonbCastForType(type: ColumnType | undefined): 'numeric' | 'timestamptz' | null {
  switch (type) {
    case 'number':
      return 'numeric'
    case 'date':
      return 'timestamptz'
    default:
      return null
  }
}

function buildColumnTypeMap(columns: ColumnDefinition[]): ColumnTypeMap {
  return new Map(columns.map((col) => [col.name, col.type]))
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
  '$ncontains',
  '$startsWith',
  '$endsWith',
  '$empty',
])

/**
 * Builds a WHERE clause from a filter object.
 * Recursively processes logical operators ($or, $and) and field conditions.
 *
 * Index behavior: equality ($eq, $in) uses the JSONB containment operator (@>) and
 * can leverage the GIN index on `user_table_rows.data` (jsonb_path_ops). Range
 * operators ($gt, $gte, $lt, $lte), pattern matches ($contains, $ncontains,
 * $startsWith, $endsWith), and emptiness checks ($empty) fall back to text
 * extraction via `data->>'field'`, which defeats the GIN index and produces
 * a sequential scan over the table's rows (bounded by a btree prefix on
 * `table_id`). Prefer equality filters on hot paths; assume range filters are
 * O(rows per table) until a per-column expression index is added.
 *
 * @param filter - Filter object with field conditions and logical operators
 * @param tableName - Table name for the query (e.g., 'user_table_rows')
 * @param columns - Column definitions; drives type-aware JSONB casts (numeric for numbers, timestamptz for dates)
 * @returns SQL WHERE clause or undefined if no filter specified
 * @throws {TableQueryValidationError} if field name is invalid or operator is not allowed
 *
 * @example
 * // Simple equality
 * buildFilterClause({ name: 'John' }, 'user_table_rows', [{ name: 'name', type: 'string' }])
 *
 * // Range on a date column — emits `::timestamptz` on both sides
 * buildFilterClause(
 *   { birthDate: { $gte: '2024-01-01' } },
 *   'user_table_rows',
 *   [{ name: 'birthDate', type: 'date' }],
 * )
 *
 * // Logical operators
 * buildFilterClause(
 *   { $or: [{ status: 'active' }, { verified: true }] },
 *   'user_table_rows',
 *   [{ name: 'status', type: 'string' }, { name: 'verified', type: 'boolean' }],
 * )
 */
export function buildFilterClause(
  filter: Filter,
  tableName: string,
  columns: ColumnDefinition[]
): SQL | undefined {
  const columnTypeMap = buildColumnTypeMap(columns)
  return buildFilterClauseInternal(filter, tableName, columnTypeMap)
}

function buildFilterClauseInternal(
  filter: Filter,
  tableName: string,
  columnTypeMap: ColumnTypeMap
): SQL | undefined {
  const conditions: SQL[] = []

  for (const [field, condition] of Object.entries(filter)) {
    if (condition === undefined) {
      continue
    }

    // This represents a case where the filter is a logical OR of multiple filters
    // e.g. { $or: [{ status: 'active' }, { status: 'pending' }] }
    if (field === '$or' && Array.isArray(condition)) {
      const orClause = buildLogicalClause(condition as Filter[], tableName, 'OR', columnTypeMap)
      if (orClause) {
        conditions.push(orClause)
      }
      continue
    }

    // This represents a case where the filter is a logical AND of multiple filters
    // e.g. { $and: [{ status: 'active' }, { status: 'pending' }] }
    if (field === '$and' && Array.isArray(condition)) {
      const andClause = buildLogicalClause(condition as Filter[], tableName, 'AND', columnTypeMap)
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
      condition as JsonValue | ConditionOperators,
      columnTypeMap.get(field)
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
 * @param columns - Column definitions; drives type-aware casts (numeric for numbers, timestamptz for dates)
 * @returns SQL ORDER BY clause or undefined if no sort specified
 * @throws {TableQueryValidationError} if field name or sort direction is invalid
 *
 * @example
 * buildSortClause(
 *   { name: 'asc' },
 *   'user_table_rows',
 *   [{ name: 'name', type: 'string' }],
 * )
 * // Returns: ORDER BY user_table_rows.data->>'name' ASC
 *
 * @example
 * buildSortClause(
 *   { salary: 'desc' },
 *   'user_table_rows',
 *   [{ name: 'salary', type: 'number' }],
 * )
 * // Returns: ORDER BY (user_table_rows.data->>'salary')::numeric DESC NULLS LAST
 */
export function buildSortClause(
  sort: Sort,
  tableName: string,
  columns: ColumnDefinition[]
): SQL | undefined {
  const clauses: SQL[] = []
  const columnTypeMap = buildColumnTypeMap(columns)

  for (const [field, direction] of Object.entries(sort)) {
    validateFieldName(field)

    if (direction !== 'asc' && direction !== 'desc') {
      throw new TableQueryValidationError(
        `Invalid sort direction "${direction}". Must be "asc" or "desc".`
      )
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
 * @throws {TableQueryValidationError} if field name is invalid
 */
function validateFieldName(field: string): void {
  if (!field || typeof field !== 'string') {
    throw new TableQueryValidationError('Field name must be a non-empty string')
  }

  if (!NAME_PATTERN.test(field)) {
    throw new TableQueryValidationError(
      `Invalid field name "${field}". Field names must start with a letter or underscore, followed by alphanumeric characters or underscores.`
    )
  }
}

/**
 * Validates an operator to ensure it's in the allowed list.
 *
 * @param operator - The operator to validate
 * @throws {TableQueryValidationError} if operator is not allowed
 */
function validateOperator(operator: string): void {
  if (!ALLOWED_OPERATORS.has(operator)) {
    throw new TableQueryValidationError(
      `Invalid operator "${operator}". Allowed operators: ${Array.from(ALLOWED_OPERATORS).join(', ')}`
    )
  }
}

/**
 * Validates that a range-operator value matches its column's expected JS type
 * before it reaches Postgres. Surfaces an actionable, column-named error at the
 * SQL builder layer instead of a generic `invalid input syntax for type numeric`
 * from the database.
 */
function validateComparisonValue(
  field: string,
  columnType: ColumnType | undefined,
  cast: 'numeric' | 'timestamptz',
  value: number | string
): void {
  if (cast === 'numeric' && typeof value !== 'number') {
    const label = columnType ?? 'number'
    throw new TableQueryValidationError(
      `Range operator on column "${field}" (${label}) requires a number, got ${typeof value}`
    )
  }
  if (cast === 'timestamptz' && typeof value !== 'string') {
    throw new TableQueryValidationError(
      `Range operator on column "${field}" (date) requires a date string, got ${typeof value}`
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
 * @throws {TableQueryValidationError} if field name is invalid or operator is not allowed
 */
function buildFieldCondition(
  tableName: string,
  field: string,
  condition: JsonValue | ConditionOperators,
  columnType: ColumnType | undefined
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
          conditions.push(
            buildComparisonClause(tableName, field, '>', value as number | string, columnType)
          )
          break

        case '$gte':
          conditions.push(
            buildComparisonClause(tableName, field, '>=', value as number | string, columnType)
          )
          break

        case '$lt':
          conditions.push(
            buildComparisonClause(tableName, field, '<', value as number | string, columnType)
          )
          break

        case '$lte':
          conditions.push(
            buildComparisonClause(tableName, field, '<=', value as number | string, columnType)
          )
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
          conditions.push(buildLikeClause(tableName, field, value as string, 'contains'))
          break

        case '$ncontains':
          conditions.push(
            buildLikeClause(tableName, field, value as string, 'contains', { negate: true })
          )
          break

        case '$startsWith':
          conditions.push(buildLikeClause(tableName, field, value as string, 'startsWith'))
          break

        case '$endsWith':
          conditions.push(buildLikeClause(tableName, field, value as string, 'endsWith'))
          break

        case '$empty':
          conditions.push(buildEmptyClause(tableName, field, coerceEmptyFlag(field, value)))
          break

        default:
          // This should never happen due to validateOperator, but added for completeness.
          // Throw a plain Error (→ 500) since reaching this default means the switch
          // and ALLOWED_OPERATORS have drifted — that's a programmer error, not a caller error.
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
  operator: 'OR' | 'AND',
  columnTypeMap: ColumnTypeMap
): SQL | undefined {
  const clauses: SQL[] = []
  for (const subFilter of subFilters) {
    const clause = buildFilterClauseInternal(subFilter, tableName, columnTypeMap)
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

/**
 * Builds a typed range comparison against a JSONB cell.
 *
 * `number` columns cast both sides to `numeric`; `date` columns cast both sides
 * to `timestamptz` so date strings compare chronologically and timezone offsets
 * in ISO strings (e.g. `2024-01-01T00:00:00Z`) are preserved rather than
 * silently stripped (which would make results depend on the server's TimeZone
 * setting). Unknown/other types
 * fall back to `numeric` (legacy default — preserves behavior for ad-hoc fields
 * with no schema entry). The right-hand value is cast explicitly because
 * drizzle parameterizes it as `text`; without the cast, Postgres would compare
 * `text <op> text` and silently produce lexicographic results.
 *
 * Cannot use the GIN index — falls back to a sequential scan over the table's
 * rows (bounded by the btree prefix on `table_id`).
 */
function buildComparisonClause(
  tableName: string,
  field: string,
  operator: '>' | '>=' | '<' | '<=',
  value: number | string,
  columnType: ColumnType | undefined
): SQL {
  const escapedField = field.replace(/'/g, "''")
  const cast = jsonbCastForType(columnType) ?? 'numeric'
  validateComparisonValue(field, columnType, cast, value)
  const cell = sql.raw(`(${tableName}.data->>'${escapedField}')::${cast}`)
  return cast === 'timestamptz'
    ? sql`${cell} ${sql.raw(operator)} ${value}::timestamptz`
    : sql`${cell} ${sql.raw(operator)} ${value}`
}

/** Escapes LIKE/ILIKE wildcard characters so they match literally */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * Builds a case-insensitive pattern match against a JSONB cell using ILIKE.
 * `position` controls wildcard placement: `contains` → `%value%`, `startsWith`
 * → `value%`, `endsWith` → `%value`. When `negate` is set the match is inverted
 * and null cells are included — "does not contain X" should keep empty rows,
 * mirroring `$ne` (which also surfaces nulls). Cannot use the GIN index; falls
 * back to a sequential scan bounded by the `table_id` btree prefix.
 */
function buildLikeClause(
  tableName: string,
  field: string,
  value: string,
  position: 'contains' | 'startsWith' | 'endsWith',
  options?: { negate?: boolean }
): SQL {
  const escapedField = field.replace(/'/g, "''")
  // Coerce defensively: filters arriving via the raw v1 API / tools may carry a
  // non-string value (e.g. `{ $contains: 123 }`), and ILIKE compares text anyway.
  const text = String(value)
  // An empty pattern collapses to `%`/`%%`, which matches every non-null row —
  // a silent footgun for raw-API callers (the UI gates empty values out). Reject
  // it, consistent with the range/`$empty` operand validation.
  if (text.length === 0) {
    const opName = position === 'contains' && options?.negate ? 'ncontains' : position
    throw new TableQueryValidationError(
      `$${opName} on column "${field}" requires a non-empty value`
    )
  }
  const escaped = escapeLikePattern(text)
  const pattern =
    position === 'startsWith'
      ? `${escaped}%`
      : position === 'endsWith'
        ? `%${escaped}`
        : `%${escaped}%`
  const cell = sql.raw(`${tableName}.data->>'${escapedField}'`)
  return options?.negate
    ? sql`(${cell} IS NULL OR ${cell} NOT ILIKE ${pattern})`
    : sql`${cell} ILIKE ${pattern}`
}

/**
 * Coerces a `$empty` operand to a boolean. Accepts a real boolean (the UI path)
 * and the string forms `'true'` / `'false'` (lenient raw-API input). Anything
 * else throws rather than silently inverting the check — a 400 with a clear
 * message beats returning the opposite row set.
 */
function coerceEmptyFlag(field: string, value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  throw new TableQueryValidationError(
    `$empty on column "${field}" requires a boolean, got ${typeof value}`
  )
}

/**
 * Builds an emptiness check against a JSONB cell. `isEmpty` matches null cells
 * (absent key or JSON null, both surfaced as SQL NULL by `->>`) and empty
 * strings; the negation requires the cell to be present and non-empty.
 */
function buildEmptyClause(tableName: string, field: string, isEmpty: boolean): SQL {
  const escapedField = field.replace(/'/g, "''")
  const cell = sql.raw(`${tableName}.data->>'${escapedField}'`)
  return isEmpty
    ? sql`(${cell} IS NULL OR ${cell} = '')`
    : sql`(${cell} IS NOT NULL AND ${cell} <> '')`
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
  columnType: ColumnType | undefined
): SQL {
  const escapedField = field.replace(/'/g, "''")
  const directionSql = direction.toUpperCase()

  if (field === 'createdAt' || field === 'updatedAt') {
    return sql.raw(`${tableName}.${escapedField} ${directionSql}`)
  }

  const jsonbExtract = `${tableName}.data->>'${escapedField}'`
  const cast = jsonbCastForType(columnType)

  if (cast === null) {
    // Sort as text (string, boolean, json, or unknown types)
    return sql.raw(`${jsonbExtract} ${directionSql}`)
  }

  // NULLS LAST so rows with null/invalid values sort to the bottom regardless of direction
  return sql.raw(`(${jsonbExtract})::${cast} ${directionSql} NULLS LAST`)
}
