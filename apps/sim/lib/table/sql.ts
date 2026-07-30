/**
 * SQL query builder utilities for user-defined tables.
 *
 * Uses JSONB containment operator (@>) for equality to leverage GIN index.
 * Uses text extraction (->>) for comparisons and pattern matching.
 */

import { isRecordLike } from '@sim/utils/object'
import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getColumnId } from '@/lib/table/column-keys'
import { NAME_PATTERN } from '@/lib/table/constants'
import { TableQueryValidationError } from '@/lib/table/errors'
import type {
  ColumnDefinition,
  ConditionOperators,
  Filter,
  FilterOp,
  JsonValue,
  Predicate,
  PredicateNode,
  Sort,
  TablePredicate,
} from '@/lib/table/types'

type ColumnType = ColumnDefinition['type']
type ColumnMap = ReadonlyMap<string, ColumnDefinition>

/**
 * Operators that make sense on a `select` column (whose values are opaque option
 * ids), split by cardinality. A single-select cell holds one id, so it compares
 * for equality; a multi-select cell holds an array of ids, so the question is
 * membership — hence contains / does-not-contain. `$eq` against an array cell
 * can never be true (`{"t":["a"]} @> {"t":"a"}` is false in Postgres), so
 * allowing it would silently match nothing.
 */
export const SINGLE_SELECT_OPERATORS = new Set(['$eq', '$ne', '$in', '$nin', '$empty'])
export const MULTI_SELECT_OPERATORS = new Set(['$contains', '$ncontains', '$empty'])

/**
 * The same allowlists in the v2 bare-operator grammar, applied inside
 * `fieldPredicate` so both wire formats gate identically. Not derived from the
 * `$` sets above by string surgery because the mapping is not 1:1 — `$empty`
 * splits into `isEmpty`/`isNotEmpty`. `isNull`/`isNotNull` have no `$`
 * equivalent and are allowed on both: a strict null check is meaningful on any
 * column, select included.
 */
const SINGLE_SELECT_OPS = new Set<FilterOp>([
  'eq',
  'ne',
  'in',
  'nin',
  'isEmpty',
  'isNotEmpty',
  'isNull',
  'isNotNull',
])
const MULTI_SELECT_OPS = new Set<FilterOp>([
  'contains',
  'ncontains',
  'isEmpty',
  'isNotEmpty',
  'isNull',
  'isNotNull',
])

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

/**
 * Maps a column's **stable id** (the JSONB storage key, via `getColumnId`) to its
 * definition. Filter/sort objects arrive keyed by column id, so the lookups in the
 * clause builders use ids — not display names. The full definition (not just the
 * type) is kept so the select branches can read `options`/`multiple`.
 */
function buildColumnMap(columns: ColumnDefinition[]): ColumnMap {
  return new Map(columns.map((col) => [getColumnId(col), col]))
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
  '$like',
  '$ilike',
  '$nlike',
  '$nilike',
  '$empty',
  '$isNull',
  '$isNotNull',
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
  const columnMap = buildColumnMap(columns)
  return buildFilterClauseInternal(filter, tableName, columnMap)
}

function buildFilterClauseInternal(
  filter: Filter,
  tableName: string,
  columnMap: ColumnMap
): SQL | undefined {
  const conditions: SQL[] = []

  for (const [field, condition] of Object.entries(filter)) {
    if (condition === undefined) {
      continue
    }

    // This represents a case where the filter is a logical OR of multiple filters
    // e.g. { $or: [{ status: 'active' }, { status: 'pending' }] }
    if (field === '$or' && Array.isArray(condition)) {
      const orClause = buildLogicalClause(condition as Filter[], tableName, 'OR', columnMap)
      if (orClause) {
        conditions.push(orClause)
      }
      continue
    }

    // This represents a case where the filter is a logical AND of multiple filters
    // e.g. { $and: [{ status: 'active' }, { status: 'pending' }] }
    if (field === '$and' && Array.isArray(condition)) {
      const andClause = buildLogicalClause(condition as Filter[], tableName, 'AND', columnMap)
      if (andClause) {
        conditions.push(andClause)
      }
      continue
    }

    // Skip arrays for regular fields - arrays are only valid for $or and $and.
    // A v2 predicate tree (`{ all | any: [...] }`) that reaches this legacy
    // compiler is a VERSION MISMATCH — a caller speaking the newer grammar
    // against an older server. Skipping it as "an array on a regular field"
    // compiles to no WHERE clause at all, which on a bulk delete means every
    // row rather than none. Fail fast and name the mismatch instead.
    if ((field === 'all' || field === 'any') && Array.isArray(condition)) {
      throw new TableQueryValidationError(
        `Filter looks like a v2 predicate tree ("${field}" group) but reached the legacy filter compiler. ` +
          'This usually means a client is sending the predicate grammar to a server that predates it.'
      )
    }

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
      columnMap.get(field)
    )
    conditions.push(...fieldConditions)
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]

  return sql.join(conditions, sql.raw(' AND '))
}

/**
 * Builds a WHERE clause from a v2 `TablePredicate` (nestable `all`/`any` groups
 * of `{ field, op, value }` leaves). Sibling of `buildFilterClause`: same engine,
 * same `fieldPredicate` leaf — only the grammar differs. Returns `undefined` when
 * the tree contributes no conditions (empty groups, all-no-op leaves).
 *
 * @throws {TableQueryValidationError} if a field name is invalid or an operator is not allowed
 */
export function buildPredicateClause(
  predicate: TablePredicate,
  tableName: string,
  columns: ColumnDefinition[]
): SQL | undefined {
  return buildPredicateNode(predicate, tableName, buildColumnMap(columns))
}

function isPredicateGroup(node: PredicateNode): node is TablePredicate {
  return 'all' in node || 'any' in node
}

function buildPredicateNode(
  node: PredicateNode,
  tableName: string,
  columnMap: ColumnMap
): SQL | undefined {
  if (isPredicateGroup(node)) {
    const isAll = 'all' in node
    const members = isAll ? node.all : node.any
    const clauses: SQL[] = []
    for (const member of members) {
      const clause = buildPredicateNode(member, tableName, columnMap)
      if (clause) clauses.push(clause)
    }
    if (clauses.length === 0) return undefined
    if (clauses.length === 1) return clauses[0]
    return sql`(${sql.join(clauses, sql.raw(isAll ? ' AND ' : ' OR '))})`
  }

  const leaf = node as Predicate
  return fieldPredicate(tableName, leaf.field, leaf.op, leaf.value, columnMap.get(leaf.field))
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
  const columnMap = buildColumnMap(columns)

  for (const [field, direction] of Object.entries(sort)) {
    validateFieldName(field)

    if (direction !== 'asc' && direction !== 'desc') {
      throw new TableQueryValidationError(
        `Invalid sort direction "${direction}". Must be "asc" or "desc".`
      )
    }

    clauses.push(buildSortFieldClause(tableName, field, direction, columnMap.get(field)))
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
  column: ColumnDefinition | undefined
): SQL[] {
  validateFieldName(field)

  const columnType = column?.type
  const isSelect = columnType === 'select'
  const isMultiSelect = isSelect && column?.multiple === true
  const conditions: SQL[] = []

  if (isRecordLike(condition)) {
    for (const [op, value] of Object.entries(condition)) {
      // Validate against the legacy `$`-whitelist, then normalize onto the shared
      // `FilterOp` so v1 and v2 emit byte-identical leaf SQL.
      validateOperator(op)
      // Select values are opaque option ids — range/pattern operators are meaningless.
      if (isSelect) {
        const allowed = isMultiSelect ? MULTI_SELECT_OPERATORS : SINGLE_SELECT_OPERATORS
        if (!allowed.has(op)) {
          throw new TableQueryValidationError(
            `Operator "${op}" is not supported on ${isMultiSelect ? 'multi-select' : 'select'} column "${field}". Allowed: ${Array.from(allowed).join(', ')}`
          )
        }
      }

      if (op === '$empty') {
        // `$empty: true/false` maps onto the valueless v2 ops.
        const filterOp: FilterOp = coerceEmptyFlag(field, value) ? 'isEmpty' : 'isNotEmpty'
        const clause = fieldPredicate(tableName, field, filterOp, undefined, column)
        if (clause) conditions.push(clause)
        continue
      }

      // Every other `$op` is `op` minus the leading `$` (e.g. `$gte` → `gte`).
      const clause = fieldPredicate(tableName, field, op.slice(1) as FilterOp, value, column)
      if (clause) conditions.push(clause)
    }
  } else {
    // Simple value (primitive or null) - shorthand for equality.
    // Example: { name: 'John' } is equivalent to { name: { $eq: 'John' } }
    // isRecordLike's negation can't structurally exclude ConditionOperators (no index
    // signature), so the JsonValue-only shape of this branch is asserted, not inferred.
    // Routes through the unified `fieldPredicate` leaf like every other matcher,
    // so equality semantics stay defined in exactly one place.
    //
    // On a multi-select the shorthand reads as "holds this option" — the cell is
    // an array of option ids, so scalar equality can never be true. It maps to
    // `contains` (membership). An EXPLICIT `$eq` on a multi-select still errors
    // via the select allowlist: writing it out is a mistake worth naming, while
    // the shorthand has an unambiguous intent.
    const shorthandOp: FilterOp = column?.type === 'select' && column.multiple ? 'contains' : 'eq'
    const clause = fieldPredicate(tableName, field, shorthandOp, condition as JsonValue, column)
    if (clause) conditions.push(clause)
  }

  return conditions
}

/**
 * The single leaf primitive: compiles one `field op value` into SQL. Every
 * matcher routes through here — both filter compilers (`buildFilterClause` for
 * the legacy `$`-grammar, `buildPredicateClause` for the v2 grammar), the upsert
 * conflict probe, and the unique-constraint checks. Centralizing the leaf means
 * equality/case/null/cast semantics are defined exactly once, so "find the row"
 * and "is this value unique" can never disagree.
 *
 * Returns `undefined` when the predicate is a no-op (empty `in`/`nin` array),
 * matching the legacy behavior of emitting no clause.
 *
 * Equality (`eq`/`ne`/`in`/`nin`) uses case-sensitive JSONB containment (GIN
 * indexed). Text matches (`contains`/`ncontains`/`startsWith`/`endsWith`) are
 * ILIKE (case-insensitive). Ranges cast per column type.
 */
export function fieldPredicate(
  tableName: string,
  field: string,
  op: FilterOp,
  value: JsonValue | undefined,
  column: ColumnDefinition | undefined
): SQL | undefined {
  validateFieldName(field)

  // System columns (`createdAt`/`updatedAt`/`id`) are real row columns, not
  // JSONB keys — dispatch before the `data->>` builders below, which would
  // silently match nothing (the key never exists in `data`).
  if (isSystemColumn(field)) {
    return buildSystemColumnClause(tableName, field, op, value)
  }

  const columnType = column?.type
  const isSelect = columnType === 'select'
  // A multi-select cell holds an ARRAY of option ids, so equality against a
  // scalar can never be true; the question is membership. Gating and clause
  // choice both live here rather than in `buildFieldCondition` so the v2
  // predicate grammar gets the identical treatment.
  const isMultiSelect = isSelect && column?.multiple === true

  if (isSelect) {
    const allowed = isMultiSelect ? MULTI_SELECT_OPS : SINGLE_SELECT_OPS
    if (!allowed.has(op)) {
      throw new TableQueryValidationError(
        `Operator "${op}" is not supported on ${isMultiSelect ? 'multi-select' : 'select'} column "${field}". Allowed: ${Array.from(allowed).join(', ')}`
      )
    }
  }

  if (isMultiSelect) {
    switch (op) {
      case 'contains':
        return buildArrayMembershipClause(tableName, field, value as JsonValue)
      case 'ncontains':
        return sql`NOT (${buildArrayMembershipClause(tableName, field, value as JsonValue)})`
      case 'isEmpty':
        return buildEmptyClause(tableName, field, true, true)
      case 'isNotEmpty':
        return buildEmptyClause(tableName, field, false, true)
      default:
        break
    }
  }

  switch (op) {
    case 'eq':
      return buildContainmentClause(tableName, field, value as JsonValue)

    case 'ne':
      return sql`NOT (${buildContainmentClause(tableName, field, value as JsonValue)})`

    case 'gt':
      return buildComparisonClause(tableName, field, '>', value as number | string, columnType)
    case 'gte':
      return buildComparisonClause(tableName, field, '>=', value as number | string, columnType)
    case 'lt':
      return buildComparisonClause(tableName, field, '<', value as number | string, columnType)
    case 'lte':
      return buildComparisonClause(tableName, field, '<=', value as number | string, columnType)

    case 'in': {
      if (!Array.isArray(value) || value.length === 0) return undefined
      if (value.length === 1) return buildContainmentClause(tableName, field, value[0])
      const inConditions = value.map((v) => buildContainmentClause(tableName, field, v))
      return sql`(${sql.join(inConditions, sql.raw(' OR '))})`
    }

    case 'nin': {
      if (!Array.isArray(value) || value.length === 0) return undefined
      const ninConditions = value.map(
        (v) => sql`NOT (${buildContainmentClause(tableName, field, v)})`
      )
      return sql`(${sql.join(ninConditions, sql.raw(' AND '))})`
    }

    case 'contains':
      return buildLikeClause(tableName, field, value as string, 'contains')
    case 'ncontains':
      return buildLikeClause(tableName, field, value as string, 'contains', { negate: true })
    case 'startsWith':
      return buildLikeClause(tableName, field, value as string, 'startsWith')
    case 'endsWith':
      return buildLikeClause(tableName, field, value as string, 'endsWith')

    case 'like':
      return buildPatternClause(tableName, field, value as string, { caseInsensitive: false })
    case 'ilike':
      return buildPatternClause(tableName, field, value as string, { caseInsensitive: true })
    case 'nlike':
      return buildPatternClause(tableName, field, value as string, {
        caseInsensitive: false,
        negate: true,
      })
    case 'nilike':
      return buildPatternClause(tableName, field, value as string, {
        caseInsensitive: true,
        negate: true,
      })

    case 'isEmpty':
      return buildEmptyClause(tableName, field, true)
    case 'isNotEmpty':
      return buildEmptyClause(tableName, field, false)

    case 'isNull':
      return buildNullClause(tableName, field, true)
    case 'isNotNull':
      return buildNullClause(tableName, field, false)

    default:
      throw new TableQueryValidationError(`Invalid operator "${op}"`)
  }
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
  columnMap: ColumnMap
): SQL | undefined {
  const clauses: SQL[] = []
  for (const subFilter of subFilters) {
    const clause = buildFilterClauseInternal(subFilter, tableName, columnMap)
    if (clause) {
      clauses.push(clause)
    }
  }

  if (clauses.length === 0) return undefined
  if (clauses.length === 1) return clauses[0]

  return sql`(${sql.join(clauses, sql.raw(` ${operator} `))})`
}

/**
 * Row columns that are addressable in filters/sorts but live on the row itself
 * rather than inside the JSONB `data` blob. The docs advertise all three as
 * filterable and sortable; without this dispatch they compile to a `data->>'…'`
 * extraction of a key that never exists, so they silently match nothing.
 */
const SYSTEM_COLUMNS: Readonly<Record<string, { column: string; kind: 'timestamp' | 'text' }>> = {
  createdAt: { column: 'created_at', kind: 'timestamp' },
  updatedAt: { column: 'updated_at', kind: 'timestamp' },
  id: { column: 'id', kind: 'text' },
}

function isSystemColumn(field: string): boolean {
  return Object.hasOwn(SYSTEM_COLUMNS, field)
}

/**
 * Builds a predicate against a system column. Timestamp columns bind ISO strings
 * normalized to UTC wall clock; the text column (`id`) binds as text and also
 * accepts the pattern ops. Anything else is rejected with an actionable error.
 */
function buildSystemColumnClause(
  tableName: string,
  field: string,
  op: FilterOp,
  value: JsonValue | undefined
): SQL | undefined {
  const spec = SYSTEM_COLUMNS[field]
  const col = sql.raw(`${tableName}.${spec.column}`)
  // `created_at`/`updated_at` are `timestamp WITHOUT time zone` holding UTC wall
  // clock. A bare `::timestamptz` comparison promotes the column using the session
  // `TimeZone` GUC, so identical queries return different rows per environment and
  // day-boundary ranges land off by the offset. Normalizing the bound to UTC wall
  // clock is session-independent and still honors an explicit offset in the input.
  const ts = (v: JsonValue | undefined) => sql`${String(v)}::timestamptz AT TIME ZONE 'UTC'`
  const bind = spec.kind === 'timestamp' ? ts : (v: JsonValue | undefined) => sql`${String(v)}`
  /**
   * Mirrors the JSONB pattern builders: `*` is the caller's only wildcard, an
   * empty pattern is rejected (it would collapse to `%` and match every row),
   * and the negated forms keep NULL cells so "does not contain X" retains them.
   */
  const like = (
    v: JsonValue | undefined,
    pattern: (escaped: string) => string,
    ci: boolean,
    negate = false
  ) => {
    const text = String(v ?? '')
    if (text.length === 0) {
      throw new TableQueryValidationError(
        `Operator "${op}" on column "${field}" requires a non-empty value`
      )
    }
    const p = pattern(escapeLikePattern(text))
    const match = ci ? sql`${col} ILIKE ${p}` : sql`${col} LIKE ${p}`
    return negate ? sql`NOT (${match})` : match
  }

  // The text system column (`id`) additionally supports the pattern ops;
  // timestamps fall through to the unsupported-operator error below.
  if (spec.kind === 'text') {
    const star = (e: string) => e.replace(/\*/g, '%')
    switch (op) {
      case 'like':
        return like(value, star, false)
      case 'ilike':
        return like(value, star, true)
      case 'nlike':
        return like(value, star, false, true)
      case 'nilike':
        return like(value, star, true, true)
      case 'contains':
        return like(value, (e) => `%${e}%`, true)
      case 'ncontains':
        return like(value, (e) => `%${e}%`, true, true)
      case 'startsWith':
        return like(value, (e) => `${e}%`, true)
      case 'endsWith':
        return like(value, (e) => `%${e}`, true)
      default:
        break
    }
  }

  switch (op) {
    case 'eq':
      return sql`${col} = ${bind(value)}`
    case 'ne':
      return sql`${col} <> ${bind(value)}`
    case 'gt':
      return sql`${col} > ${bind(value)}`
    case 'gte':
      return sql`${col} >= ${bind(value)}`
    case 'lt':
      return sql`${col} < ${bind(value)}`
    case 'lte':
      return sql`${col} <= ${bind(value)}`
    case 'in': {
      if (!Array.isArray(value) || value.length === 0) return undefined
      return sql`${col} IN (${sql.join(value.map(bind), sql.raw(', '))})`
    }
    case 'nin': {
      if (!Array.isArray(value) || value.length === 0) return undefined
      return sql`${col} NOT IN (${sql.join(value.map(bind), sql.raw(', '))})`
    }
    case 'isNull':
    case 'isEmpty':
      return sql`${col} IS NULL`
    case 'isNotNull':
    case 'isNotEmpty':
      return sql`${col} IS NOT NULL`
    default:
      throw new TableQueryValidationError(
        `Operator "${op}" is not supported on the built-in column "${field}" — use eq, ne, gt, gte, lt, lte, in, nin, isNull, isNotNull.`
      )
  }
}

/** Builds JSONB containment clause: `data @> '{"field": value}'::jsonb` (uses GIN index) */
function buildContainmentClause(tableName: string, field: string, value: JsonValue): SQL {
  const jsonObj = JSON.stringify({ [field]: value })
  return sql`${sql.raw(`${tableName}.data`)} @> ${jsonObj}::jsonb`
}

/**
 * Builds an array-membership clause for a multi-select cell:
 * `data @> '{"field": [value]}'::jsonb`.
 *
 * The value is wrapped in an array because Postgres containment requires
 * matching structure — `{"t":["a","b"]} @> {"t":"a"}` is **false**, while
 * `{"t":["a","b"]} @> {"t":["a"]}` is true. Same GIN index as the scalar form.
 */
function buildArrayMembershipClause(tableName: string, field: string, value: JsonValue): SQL {
  const jsonObj = JSON.stringify({ [field]: [value] })
  return sql`${sql.raw(`${tableName}.data`)} @> ${jsonObj}::jsonb`
}

/**
 * Builds a typed range comparison against a JSONB cell.
 *
 * `number` columns cast both sides to `numeric`; `date` columns cast both sides
 * to `timestamptz` so date strings compare chronologically and timezone offsets
 * in ISO strings (e.g. `2024-01-01T00:00:00Z`) are preserved rather than
 * silently stripped (which would make results depend on the server's TimeZone
 * setting). `string` columns compare lexicographically as text. `boolean`/`json`
 * columns have no meaningful ordering and are rejected. Columns with no schema
 * entry fall back to `numeric` (legacy default — preserves behavior for ad-hoc
 * fields). The right-hand value is cast explicitly because drizzle parameterizes
 * it as `text`; without the cast, Postgres would compare `text <op> text` and
 * silently produce lexicographic results.
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

  if (columnType === 'boolean' || columnType === 'json') {
    throw new TableQueryValidationError(
      `Range operator on column "${field}" (${columnType}) is not supported — ${columnType} values have no ordering.`
    )
  }

  if (columnType === 'string') {
    const cell = sql.raw(`${tableName}.data->>'${escapedField}'`)
    return sql`${cell} ${sql.raw(operator)} ${String(value)}`
  }

  const cast = jsonbCastForType(columnType) ?? 'numeric'
  validateComparisonValue(field, columnType, cast, value)
  const cell = sql.raw(`(${tableName}.data->>'${escapedField}')::${cast}`)
  return cast === 'timestamptz'
    ? sql`${cell} ${sql.raw(operator)} ${value}::timestamptz`
    : sql`${cell} ${sql.raw(operator)} ${value}`
}

/** Escapes LIKE/ILIKE wildcard characters so they match literally */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/**
 * General LIKE/ILIKE pattern match (the `like`/`ilike` ops). The caller's `*`
 * is the only wildcard — it maps to SQL `%`; any literal `%`/`_`/`\` in the
 * value is escaped so it matches itself. Empty/exact patterns are allowed (an
 * empty pattern matches only the empty string, not every row, so it's not the
 * footgun the positional `buildLikeClause` guards against). `negate` inverts
 * the match and keeps null cells — "does not match" retains empty rows,
 * mirroring `buildLikeClause`'s ncontains semantics. Cannot use the GIN index;
 * sequential scan bounded by the `table_id` btree prefix.
 */
function buildPatternClause(
  tableName: string,
  field: string,
  value: string,
  options: { caseInsensitive: boolean; negate?: boolean }
): SQL {
  const escapedField = field.replace(/'/g, "''")
  const pattern = String(value)
    .replace(/[\\%_]/g, '\\$&')
    .replace(/\*/g, '%')
  const cell = sql.raw(`${tableName}.data->>'${escapedField}'`)
  const match = options.caseInsensitive
    ? sql`${cell} ILIKE ${pattern}`
    : sql`${cell} LIKE ${pattern}`
  if (!options.negate) return match
  return options.caseInsensitive
    ? sql`(${cell} IS NULL OR ${cell} NOT ILIKE ${pattern})`
    : sql`(${cell} IS NULL OR ${cell} NOT LIKE ${pattern})`
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
 * strings; the negation requires the cell to be present and non-empty. A
 * multiselect cell holds a JSON array, so `->>'field'` renders `[]` (not '')
 * when nothing is selected — treat that text as empty too.
 */
function buildEmptyClause(
  tableName: string,
  field: string,
  isEmpty: boolean,
  isArray = false
): SQL {
  const escapedField = field.replace(/'/g, "''")
  const cell = sql.raw(`${tableName}.data->>'${escapedField}'`)
  if (isArray) {
    // A multiselect renders `[]` when nothing is selected; treat that as empty too.
    return isEmpty
      ? sql`(${cell} IS NULL OR ${cell} = '' OR ${cell} = '[]')`
      : sql`(${cell} IS NOT NULL AND ${cell} <> '' AND ${cell} <> '[]')`
  }
  return isEmpty
    ? sql`(${cell} IS NULL OR ${cell} = '')`
    : sql`(${cell} IS NOT NULL AND ${cell} <> '')`
}

/**
 * Strict null check on a JSONB cell — distinct from `isEmpty`/`isNotEmpty`,
 * which also treat the empty string as empty. `isNull` matches an absent key or
 * JSON null (both surfaced as SQL NULL by `->>`); the negation requires the cell
 * to be present (an empty string counts as not-null here).
 */
function buildNullClause(tableName: string, field: string, isNull: boolean): SQL {
  const escapedField = field.replace(/'/g, "''")
  const cell = sql.raw(`${tableName}.data->>'${escapedField}'`)
  return isNull ? sql`${cell} IS NULL` : sql`${cell} IS NOT NULL`
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
  column: ColumnDefinition | undefined
): SQL {
  const escapedField = field.replace(/'/g, "''")
  const directionSql = direction.toUpperCase()

  if (isSystemColumn(field)) {
    return sql.raw(`${tableName}.${SYSTEM_COLUMNS[field].column} ${directionSql}`)
  }

  const jsonbExtract = `${tableName}.data->>'${escapedField}'`

  // Select cells store opaque option ids; sort by the option **name** so ordering
  // is alphabetical by the label the user sees, not by the internal id. A stored
  // id with no matching option (deleted) falls back to the raw text.
  if (column?.type === 'select') {
    const orderExpr = buildSelectNameOrderExpr(
      jsonbExtract,
      `${tableName}.data->'${escapedField}'`,
      column
    )
    return sql.raw(`${orderExpr} ${directionSql} NULLS LAST`)
  }

  const cast = jsonbCastForType(column?.type)

  if (cast === null) {
    // Sort as text (string, boolean, json, or unknown types)
    return sql.raw(`${jsonbExtract} ${directionSql}`)
  }

  // NULLS LAST so rows with null/invalid values sort to the bottom regardless of direction
  return sql.raw(`(${jsonbExtract})::${cast} ${directionSql} NULLS LAST`)
}

/**
 * Builds a `CASE` expression mapping a select cell's stored option id (the JSONB
 * text extract) to its option name, so an ORDER BY sorts alphabetically by label.
 * Ids and names are SQL-escaped and embedded literally (options are trusted schema
 * data, not caller input); an unmapped id falls through to the raw extract.
 *
 * A multiselect cell is an array of ids, which matches no single-id branch — it
 * sorts on its elements resolved to names and joined in stored order, the same
 * text the grid renders and an export writes. A scalar left over from before a
 * single→multi toggle still takes the single-id branch.
 */
function buildSelectNameOrderExpr(
  jsonbExtract: string,
  jsonbValue: string,
  column: ColumnDefinition
): string {
  const options = column.options ?? []
  if (options.length === 0) return jsonbExtract
  const whens = options
    .map((o) => `WHEN '${o.id.replace(/'/g, "''")}' THEN '${o.name.replace(/'/g, "''")}'`)
    .join(' ')
  const singleExpr = `CASE ${jsonbExtract} ${whens} ELSE ${jsonbExtract} END`
  if (!column.multiple) return singleExpr

  const nameById = JSON.stringify(
    Object.fromEntries(new Map(options.map((o) => [o.id, o.name])))
  ).replace(/'/g, "''")
  return `CASE WHEN jsonb_typeof(${jsonbValue}) = 'array' THEN (
    SELECT string_agg(COALESCE('${nameById}'::jsonb ->> e.v, e.v), ', ' ORDER BY e.ord)
    FROM jsonb_array_elements_text(${jsonbValue}) WITH ORDINALITY AS e(v, ord)
  ) ELSE ${singleExpr} END`
}
