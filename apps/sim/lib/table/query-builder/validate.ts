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
 * PostgREST parser did inline, now grammar-agnostic and applied to the object
 * directly (predicates are column-NAME-keyed at the boundary, translated to ids
 * afterwards).
 */

/** Equality/containment ops that are meaningless on a `json` column (they never match). */
const CONTAINMENT_OPS = new Set<FilterOp>(['eq', 'ne', 'in', 'nin'])

/** System timestamp columns are filterable/sortable but are not in `schema.columns`. */
const SYSTEM_COLUMN_TYPES: ReadonlyArray<[string, ColumnType]> = [
  ['createdAt', 'date'],
  ['updatedAt', 'date'],
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

function validateLeaf(leaf: Predicate, typeByName: Map<string, ColumnType>): void {
  validateFieldName(leaf.field)
  if (!typeByName.has(leaf.field)) {
    throw new TableQueryValidationError(
      `Unknown filter column "${leaf.field}". It is not a column on this table.`,
      'INVALID_FILTER'
    )
  }
  if (typeByName.get(leaf.field) === 'json' && CONTAINMENT_OPS.has(leaf.op)) {
    throw new TableQueryValidationError(
      `Operator "${leaf.op}" is not supported on json column "${leaf.field}" — use like/ilike for text match or is.null.`,
      'INVALID_FILTER'
    )
  }
  if (
    (leaf.op === 'in' || leaf.op === 'nin') &&
    (!Array.isArray(leaf.value) || leaf.value.length === 0)
  ) {
    throw new TableQueryValidationError(
      `Operator "${leaf.op}" on column "${leaf.field}" requires a non-empty array value.`,
      'INVALID_FILTER'
    )
  }
}

function validateNode(node: PredicateNode, typeByName: Map<string, ColumnType>): void {
  // Guard before the `in` checks below: an untrusted caller (copilot args, a raw
  // block value) can hand us a string/number/null, where `'all' in node` throws
  // a raw TypeError. Fail with a clean, actionable message instead.
  if (typeof node !== 'object' || node === null) {
    throw new TableQueryValidationError(
      'Filter must be a predicate object ({ all | any: [...] }).',
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
    for (const child of members) validateNode(child, typeByName)
    return
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
