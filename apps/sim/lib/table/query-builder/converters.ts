/**
 * Converters for transforming between UI builder state and API filter/sort objects.
 */

import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { columnMatchesRef } from '@/lib/table/column-keys'
import { TableQueryValidationError } from '@/lib/table/errors'
import {
  MULTI_SELECT_FILTER_OPERATORS,
  SINGLE_SELECT_FILTER_OPERATORS,
} from '@/lib/table/query-builder/constants'
import type {
  ColumnDefinition,
  Filter,
  FilterOp,
  FilterRule,
  JsonValue,
  Predicate,
  Sort,
  SortDirection,
  SortRule,
  SortSpec,
  TablePredicate,
} from '@/lib/table/types'

/**
 * Converts UI filter rules to a Filter object for API queries.
 *
 * Pass `columns` whenever they are known. A `select` value is an opaque option
 * id, and ids are caller-supplied strings — an id of `"1"`, `"true"` or
 * `"null"` would otherwise be coerced to a number/boolean/null and then compared
 * against the stored JSON string by containment, matching nothing.
 */
export function filterRulesToFilter(
  rules: FilterRule[],
  columns: ColumnDefinition[] = []
): Filter | null {
  if (rules.length === 0) return null

  const orGroups: Filter[] = []
  let currentGroup: Filter = {}

  for (const rule of rules) {
    // Honor the OR boundary before skipping incomplete rows, so an incomplete
    // `or` row between two valid conditions still starts a new group.
    const isOr = rule.logicalOperator === 'or'
    if (isOr && Object.keys(currentGroup).length > 0) {
      orGroups.push({ ...currentGroup })
      currentGroup = {}
    }

    // Skip incomplete rows (no column selected) so a blank builder row never
    // serializes to a `{ '': ... }` predicate. The OR boundary above is still
    // applied; the row just contributes no condition.
    if (!rule.column) continue

    const isSelect = columns.find((c) => columnMatchesRef(c, rule.column))?.type === 'select'
    const ruleValue = toRuleValue(rule.operator, rule.value, isSelect)
    const existing = currentGroup[rule.column]
    currentGroup[rule.column] =
      existing === undefined
        ? (ruleValue as Filter[string])
        : (mergeConditions(existing, ruleValue) as Filter[string])
  }

  if (Object.keys(currentGroup).length > 0) {
    orGroups.push(currentGroup)
  }

  return orGroups.length > 1 ? { $or: orGroups } : orGroups[0] || null
}

/** Converts a Filter object back to UI filter rules. */
export function filterToRules(filter: Filter | null): FilterRule[] {
  if (!filter) return []

  if (filter.$or && Array.isArray(filter.$or)) {
    const groups = filter.$or
      .map((orGroup) => parseFilterGroup(orGroup as Filter))
      .filter((group) => group.length > 0)
    return applyLogicalOperators(groups)
  }

  return parseFilterGroup(filter)
}

/**
 * Drops filter conditions a `select` column no longer accepts.
 *
 * The server rejects an unsupported operator on a select column outright, so a
 * filter applied before a column became `select` — or before its `multiple`
 * flag flipped — would make every subsequent query throw and leave the grid
 * stuck until the user cleared the filter by hand. Pruning the dead condition
 * instead degrades to a broader result set, which is recoverable.
 *
 * Only conditions on a column we can positively identify as `select` are
 * dropped; an unresolved column name is left for the server to judge.
 */
export function pruneFilterForColumns(
  filter: Filter | null,
  columns: ColumnDefinition[]
): Filter | null {
  if (!filter) return null

  const rules = filterToRules(filter)
  const kept = rules.filter((rule) => {
    const column = columns.find((c) => columnMatchesRef(c, rule.column))
    if (column?.type !== 'select') return true
    const allowed = column.multiple ? MULTI_SELECT_FILTER_OPERATORS : SINGLE_SELECT_FILTER_OPERATORS
    return allowed.has(rule.operator)
  })

  if (kept.length === rules.length) return filter
  // Columns forwarded: the round-trip through rules would otherwise re-coerce a
  // select option id like `"1"` into a number on the way back out.
  return filterRulesToFilter(kept, columns)
}

/** Converts a single UI sort rule to a Sort object for API queries. */
export function sortRuleToSort(rule: SortRule | null): Sort | null {
  if (!rule || !rule.column) return null
  return { [rule.column]: rule.direction }
}

/** Converts multiple UI sort rules to a Sort object. */
export function sortRulesToSort(rules: SortRule[]): Sort | null {
  if (rules.length === 0) return null

  const sort: Sort = {}
  for (const rule of rules) {
    if (rule.column) {
      sort[rule.column] = rule.direction
    }
  }

  return Object.keys(sort).length > 0 ? sort : null
}

/** Converts a Sort object back to UI sort rules. */
export function sortToRules(sort: Sort | null): SortRule[] {
  if (!sort) return []

  return Object.entries(sort).map(([column, direction]) => ({
    id: generateShortId(),
    column,
    direction: normalizeSortDirection(direction),
  }))
}

function toRuleValue(operator: string, value: string, keepAsText = false): JsonValue {
  if (operator === 'isEmpty') return { $empty: true }
  if (operator === 'isNotEmpty') return { $empty: false }
  const parsedValue = parseValue(value, operator, keepAsText)
  return operator === 'eq' ? parsedValue : { [`$${operator}`]: parsedValue }
}

/**
 * Merges two conditions targeting the same column within one AND group into a
 * single operator object, so `age > 18 AND age < 65` becomes
 * `{ age: { $gt: 18, $lt: 65 } }` instead of the second rule clobbering the
 * first. Bare-equality shorthands are normalized to `{ $eq: value }` so they
 * can coexist with operators. On a same-operator collision (e.g. two
 * `$contains`) the later rule wins.
 */
function mergeConditions(existing: unknown, incoming: unknown): Record<string, JsonValue> {
  return { ...toOperatorObject(existing), ...toOperatorObject(incoming) }
}

function toOperatorObject(value: unknown): Record<string, JsonValue> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, JsonValue>) }
  }
  return { $eq: value as JsonValue }
}

function applyLogicalOperators(groups: FilterRule[][]): FilterRule[] {
  const rules: FilterRule[] = []

  groups.forEach((group, groupIndex) => {
    group.forEach((rule, ruleIndex) => {
      rules.push({
        ...rule,
        logicalOperator:
          groupIndex === 0 && ruleIndex === 0
            ? 'and'
            : groupIndex > 0 && ruleIndex === 0
              ? 'or'
              : 'and',
      })
    })
  })

  return rules
}

const ARRAY_OPERATORS = new Set(['in', 'nin'])
const TEXT_MATCH_OPERATORS = new Set(['contains', 'ncontains', 'startsWith', 'endsWith'])

function parseValue(value: string, operator: string, keepAsText = false): JsonValue {
  if (ARRAY_OPERATORS.has(operator)) {
    return value
      .split(',')
      .map((part) => part.trim())
      .map((part) => (keepAsText ? part : parseScalar(part)))
  }

  // An opaque identifier (a select option id) must never be coerced — see
  // `filterRulesToFilter`.
  if (keepAsText) return value

  // Substring/prefix/suffix matches are textual — keep the raw string so a value
  // like "123" isn't coerced to a number the SQL builder's ILIKE path can't use.
  if (TEXT_MATCH_OPERATORS.has(operator)) {
    return value
  }

  return parseScalar(value)
}

function parseScalar(value: string): JsonValue {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (!Number.isNaN(Number(value)) && value !== '') return Number(value)
  return value
}

function parseFilterGroup(group: Filter): FilterRule[] {
  if (!group || typeof group !== 'object' || Array.isArray(group)) return []

  const rules: FilterRule[] = []

  for (const [column, value] of Object.entries(group)) {
    if (column === '$or' || column === '$and') continue

    if (isRecordLike(value)) {
      for (const [op, opValue] of Object.entries(value)) {
        if (!op.startsWith('$')) continue
        // `$empty` is a valueless boolean operator — map it back to the two
        // distinct UI operators rather than exposing a raw `empty` operator.
        // Accept the string forms `'true'`/`'false'` too, matching the lenient
        // coercion in the SQL builder's `coerceEmptyFlag` so a filter authored
        // via the raw API doesn't flip its predicate when re-opened in the UI.
        if (op === '$empty') {
          rules.push({
            id: generateShortId(),
            logicalOperator: 'and',
            column,
            operator: opValue === true || opValue === 'true' ? 'isEmpty' : 'isNotEmpty',
            value: '',
          })
          continue
        }
        rules.push({
          id: generateShortId(),
          logicalOperator: 'and',
          column,
          operator: op.substring(1),
          value: formatValueForBuilder(opValue as JsonValue),
        })
      }
      continue
    }

    rules.push({
      id: generateShortId(),
      logicalOperator: 'and',
      column,
      operator: 'eq',
      value: formatValueForBuilder(value as JsonValue),
    })
  }

  return rules
}

function formatValueForBuilder(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(formatValueForBuilder).join(', ')
  return String(value)
}

function normalizeSortDirection(direction: string): SortDirection {
  return direction === 'desc' ? 'desc' : 'asc'
}

/* ----------------------------- v2 grammar ----------------------------- */

const VALUELESS_OPS = new Set<FilterOp>(['isEmpty', 'isNotEmpty', 'isNull', 'isNotNull'])

function ruleToPredicate(rule: FilterRule): Predicate {
  const op = rule.operator as FilterOp
  if (VALUELESS_OPS.has(op)) return { field: rule.column, op }
  return { field: rule.column, op, value: parseValue(rule.value, rule.operator) }
}

/**
 * Converts UI builder rules to a v2 `TablePredicate`. Rules within an `or`
 * boundary form an `all` group; multiple groups are combined under `any`.
 * Mirrors {@link filterRulesToFilter} but emits the bare-operator grammar.
 */
export function filterRulesToPredicate(rules: FilterRule[]): TablePredicate | null {
  // Tolerate a non-array (the builder value can arrive malformed from an agent
  // that doesn't speak the rule shape) instead of throwing "rules is not iterable".
  if (!Array.isArray(rules) || rules.length === 0) return null

  const groups: Predicate[][] = []
  let current: Predicate[] = []

  for (const rule of rules) {
    if (rule.logicalOperator === 'or' && current.length > 0) {
      groups.push(current)
      current = []
    }
    if (!rule.column) {
      // A predicate-shaped member ({field, op, value}) means the caller mixed the
      // two grammars — most likely an agent writing predicate leaves into the
      // visual builder. Silently skipping it would DROP that condition and widen
      // the result, which on a bulk delete/update is destructive.
      if (isRecordLike(rule) && ('field' in rule || 'op' in rule)) {
        throw new TableQueryValidationError(
          'Filter looks like a predicate condition but was supplied as a builder rule. ' +
            'Provide the whole filter as a predicate object ({ all | any: [...] }) instead of mixing shapes.',
          'INVALID_FILTER'
        )
      }
      // A genuinely blank builder row (no column picked yet) contributes nothing.
      continue
    }
    current.push(ruleToPredicate(rule))
  }
  if (current.length > 0) groups.push(current)

  if (groups.length === 0) return null
  if (groups.length === 1) return { all: groups[0] }
  return { any: groups.map((group) => ({ all: group })) }
}

function predicateLeafToRule(p: Predicate): FilterRule {
  return {
    id: generateShortId(),
    logicalOperator: 'and',
    column: p.field,
    operator: p.op,
    value: VALUELESS_OPS.has(p.op) ? '' : formatValueForBuilder(p.value as JsonValue),
  }
}

/** Flattens a predicate node into builder rules (best-effort for deep nesting). */
function predicateGroupToRules(node: TablePredicate | Predicate): FilterRule[] {
  if ('field' in node) return [predicateLeafToRule(node)]
  const members = 'all' in node ? node.all : node.any
  return members.flatMap((member) =>
    'field' in member ? [predicateLeafToRule(member)] : predicateGroupToRules(member)
  )
}

/** Converts a v2 `TablePredicate` back to UI builder rules. */
export function predicateToFilterRules(predicate: TablePredicate | null): FilterRule[] {
  if (!predicate) return []
  if ('any' in predicate) {
    const groups = predicate.any
      .map((node) => predicateGroupToRules(node))
      .filter((g) => g.length > 0)
    return applyLogicalOperators(groups)
  }
  return predicateGroupToRules(predicate)
}

/** Converts UI sort rules to a v2 `SortSpec` (ordered `{ field, direction }`). */
export function sortRulesToSortSpec(rules: SortRule[]): SortSpec | null {
  const spec: SortSpec = []
  for (const rule of rules) {
    if (rule.column) spec.push({ field: rule.column, direction: rule.direction })
  }
  return spec.length > 0 ? spec : null
}

function predicateLeafToFilterValue(p: Predicate): Filter[string] {
  if (p.op === 'isEmpty') return { $empty: true }
  if (p.op === 'isNotEmpty') return { $empty: false }
  // Valueless null checks carry a dummy `true` so the key survives JSON transport.
  if (p.op === 'isNull') return { $isNull: true } as Filter[string]
  if (p.op === 'isNotNull') return { $isNotNull: true } as Filter[string]

  // Fail loud rather than emit a leaf `buildFilterClause` silently discards. It skips
  // an `undefined` condition and any array-valued one, so a dropped leaf WIDENS the
  // result — and on the bulk delete/update paths a predicate whose only leaf is
  // dropped compiles to no WHERE at all. `op:'eq'` with an array is the realistic
  // trigger (an LLM reaching for `in` and writing `eq`).
  if (!VALUELESS_OPS.has(p.op) && p.value === undefined) {
    throw new TableQueryValidationError(
      `Operator "${p.op}" on column "${p.field}" requires a value.`,
      'INVALID_FILTER'
    )
  }
  if (p.op === 'eq') {
    if (Array.isArray(p.value)) {
      throw new TableQueryValidationError(
        `Operator "eq" on column "${p.field}" does not accept an array — use "in" to match any of several values.`,
        'INVALID_FILTER'
      )
    }
    return p.value as Filter[string]
  }
  return { [`$${p.op}`]: p.value } as Filter[string]
}

/**
 * Converts a v2 `TablePredicate` to a legacy `$`-grammar `Filter`. Lossless —
 * both compile through the same `fieldPredicate` leaf, so the resulting SQL is
 * identical. Lets v2 surfaces author in the predicate grammar while the bulk
 * update/delete engine (sync + async-job paths) keeps consuming `Filter`.
 */
export function predicateToFilter(predicate: TablePredicate): Filter {
  const nodeToFilter = (node: Predicate | TablePredicate): Filter => {
    // Group-first, matching isPredicateGroup/validateNode/buildPredicateNode. A
    // leaf-first test would execute a different predicate than the one validated.
    if ('all' in node) return { $and: node.all.map(nodeToFilter) }
    if ('any' in node) return { $or: node.any.map(nodeToFilter) }
    return { [node.field]: predicateLeafToFilterValue(node) }
  }
  return nodeToFilter(predicate)
}
