import { isRecordLike } from '@sim/utils/object'
import { getColumnId } from '@/lib/table/column-keys'
import { NAME_PATTERN } from '@/lib/table/constants'
import { TableQueryValidationError } from '@/lib/table/errors'
import type {
  ColumnDefinition,
  ColumnType,
  FilterOp,
  Predicate,
  PredicateNode,
  SortSpec,
  TablePredicate,
} from '@/lib/table/types'

/**
 * Schema-aware validation for the typed predicate/sort wire. The engine
 * (`buildPredicateClause`) trusts its input, so this is the boundary gate that
 * every caller-supplied filter/sort passes through — the same checks the old
 * parser used to do inline, now grammar-agnostic and applied to the object
 * directly (predicates are column-NAME-keyed at the boundary, translated to ids
 * afterwards).
 */

/** Equality/containment ops that are meaningless on a `json` column (they never match). */
const CONTAINMENT_OPS = new Set<FilterOp>(['eq', 'ne', 'in', 'nin'])

/** Ops that legitimately carry no `value`. */
const VALUELESS_OPS = new Set<FilterOp>(['isEmpty', 'isNotEmpty', 'isNull', 'isNotNull'])

/**
 * Cap on `in`/`nin` list length. Each element becomes its own containment clause,
 * so an unbounded list is a cheap memory/CPU amplifier from a small request body.
 */
const MAX_IN_LIST_SIZE = 1000

/**
 * Row-level system columns are filterable/sortable but are not in
 * `schema.columns`. Must stay in sync with `SYSTEM_COLUMNS` in `lib/table/sql.ts`
 * — a name here with no SQL dispatch there compiles to a `data->>` extraction
 * that silently matches nothing.
 */
const SYSTEM_COLUMN_TYPES: ReadonlyArray<[string, ColumnType]> = [
  ['createdAt', 'date'],
  ['updatedAt', 'date'],
  ['id', 'string'],
]

function buildTypeByName(columns: ColumnDefinition[]): Map<string, ColumnType> {
  const typeByName = new Map<string, ColumnType>(columns.map((c) => [c.name, c.type]))
  for (const [name, type] of SYSTEM_COLUMN_TYPES) typeByName.set(name, type)
  return typeByName
}

function validateFieldName(field: string): void {
  if (!NAME_PATTERN.test(field)) {
    throw new TableQueryValidationError(
      `Invalid filter column "${field}". Use a column name (letters, digits, underscore).`,
      'INVALID_FILTER'
    )
  }
}

function validateLeaf(leaf: Predicate, typeByName: Map<string, ColumnType> | null): void {
  validateFieldName(leaf.field)
  if (typeByName && !typeByName.has(leaf.field)) {
    throw new TableQueryValidationError(
      `Unknown filter column "${leaf.field}". It is not a column on this table.`,
      'INVALID_FILTER'
    )
  }
  if (typeByName?.get(leaf.field) === 'json' && CONTAINMENT_OPS.has(leaf.op)) {
    throw new TableQueryValidationError(
      `Operator "${leaf.op}" is not supported on json column "${leaf.field}" — use like/ilike for text match, or isNull/isNotNull.`,
      'INVALID_FILTER'
    )
  }
  if (leaf.op === 'in' || leaf.op === 'nin') {
    if (!Array.isArray(leaf.value) || leaf.value.length === 0) {
      throw new TableQueryValidationError(
        `Operator "${leaf.op}" on column "${leaf.field}" requires a non-empty array value.`,
        'INVALID_FILTER'
      )
    }
    if (leaf.value.length > MAX_IN_LIST_SIZE) {
      throw new TableQueryValidationError(
        `Operator "${leaf.op}" on column "${leaf.field}" accepts at most ${MAX_IN_LIST_SIZE} values, got ${leaf.value.length}.`,
        'INVALID_FILTER'
      )
    }
    return
  }
  // A value-taking op with no value, or a scalar op handed an array, compiles to a
  // clause the legacy `$`-grammar silently discards — which WIDENS a bulk delete or
  // update. Reject here so the copilot path (no Zod) fails the same way the HTTP
  // boundary does.
  if (!VALUELESS_OPS.has(leaf.op) && leaf.value === undefined) {
    throw new TableQueryValidationError(
      `Operator "${leaf.op}" on column "${leaf.field}" requires a value.`,
      'INVALID_FILTER'
    )
  }
  if (Array.isArray(leaf.value)) {
    throw new TableQueryValidationError(
      `Operator "${leaf.op}" on column "${leaf.field}" does not accept an array — use "in" to match any of several values.`,
      'INVALID_FILTER'
    )
  }
}

/**
 * Structure-only validation: hybrid nodes, group shapes, leaf value rules —
 * everything that does not require knowing the table's columns. Used by the
 * dual-grammar boundaries where the predicate may be NAME- or ID-keyed, so a
 * column-existence check against either keying would be wrong.
 */
export function validatePredicateShape(predicate: TablePredicate): void {
  validateNode(predicate, null)
}

function validateNode(node: PredicateNode, typeByName: Map<string, ColumnType> | null): void {
  // Guard before the `in` checks below: an untrusted caller (copilot args, a raw
  // block value) can hand us a string/number/null, where `'all' in node` throws
  // a raw TypeError. Fail with a clean, actionable message instead.
  if (typeof node !== 'object' || node === null) {
    throw new TableQueryValidationError(
      'Filter must be a predicate object ({ all | any: [...] }).',
      'INVALID_FILTER'
    )
  }
  // A node carrying BOTH a group key and `field` is ambiguous: the engine and this
  // validator read it group-first while `predicateToFilter`/`predicateNamesToIds`
  // read it leaf-first, so the gate would validate one predicate and the bulk-write
  // path would execute a different one. Reject rather than pick a winner.
  if (('all' in node || 'any' in node) && 'field' in node) {
    throw new TableQueryValidationError(
      'A filter node must be either a group ({ all | any: [...] }) or a condition ({ field, op, value }), not both.',
      'INVALID_FILTER'
    )
  }
  if ('all' in node || 'any' in node) {
    const members = 'all' in node ? node.all : node.any
    if (!Array.isArray(members)) {
      throw new TableQueryValidationError(
        'A filter group ({ all | any }) must be an array of conditions.',
        'INVALID_FILTER'
      )
    }
    // Mirrors the Zod contract's .min(1). An empty group slips the strict union
    // (falling to the non-empty-OBJECT legacy branch) and compiles to no WHERE
    // clause — which on the run/cancel/delete scopes silently means EVERY row.
    if (members.length === 0) {
      throw new TableQueryValidationError(
        'A filter group must contain at least one condition.',
        'INVALID_FILTER'
      )
    }
    for (const child of members) validateNode(child, typeByName)
    return
  }
  // Neither a group nor a leaf. Overwhelmingly this is the legacy `$`-grammar
  // (`{ status: { $eq: 'x' } }`) — a shape `validateLeaf` would reject as
  // `Unknown filter column "undefined"`, which tells an LLM caller nothing and
  // sends it retrying column names forever. Name the actual mistake.
  if (!('field' in node)) {
    const keys = Object.keys(node)
    const looksLegacy = keys.some(
      (k) => k.startsWith('$') || isRecordLike((node as Record<string, unknown>)[k])
    )
    throw new TableQueryValidationError(
      looksLegacy
        ? 'Filter uses the legacy operator-object grammar. Use a predicate tree instead: { all: [{ field, op, value }] } (or "any" for OR), with bare operators like eq/gte/contains/in.'
        : 'A filter node must be a group ({ all | any: [...] }) or a condition ({ field, op, value }).',
      'INVALID_FILTER'
    )
  }
  validateLeaf(node as Predicate, typeByName)
}

/**
 * Validates a name-keyed predicate against the table schema: every leaf field
 * exists, no equality/containment op targets a `json` column, `in`/`nin` carry a
 * non-empty array. Throws {@link TableQueryValidationError} (`INVALID_FILTER`).
 */
export function validatePredicate(predicate: TablePredicate, columns: ColumnDefinition[]): void {
  validateNode(predicate, buildTypeByName(columns))
}

/** Validates a name-keyed sort spec: every field is a real or system column. */
export function validateSortSpec(spec: SortSpec, columns: ColumnDefinition[]): void {
  const typeByName = buildTypeByName(columns)
  for (const { field } of spec) {
    validateFieldName(field)
    if (!typeByName.has(field)) {
      throw new TableQueryValidationError(`Unknown sort column "${field}"`, 'INVALID_ORDER')
    }
  }
}

/**
 * Validates a STORAGE-keyed predicate — leaf fields are column ids (plus the
 * system columns, which keep their names). Runs AFTER wire translation, which
 * makes it keying-correct for every caller: a session caller's ids are already
 * storage keys, and a workflow tool's names have just been translated — so any
 * field left unresolved here is a typo, and on the bulk write paths a typo must
 * 400 rather than compile to a filter that silently matches nothing.
 */
export function validateStoragePredicate(
  predicate: TablePredicate,
  columns: ColumnDefinition[]
): void {
  const typeById = new Map<string, ColumnType>(columns.map((c) => [getColumnId(c), c.type]))
  for (const [name, type] of SYSTEM_COLUMN_TYPES) typeById.set(name, type)
  validateNode(predicate, typeById)
}
