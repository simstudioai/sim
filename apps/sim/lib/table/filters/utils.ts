/**
 * Utilities for converting between UI builder state and API filter/sort objects.
 */

import { nanoid } from 'nanoid'
import type { Filter, FilterRule, JsonValue, Sort, SortDirection, SortRule } from '../types'

/** Converts UI filter rules to a Filter object for API queries. */
export function filterRulesToFilter(rules: FilterRule[]): Filter | null {
  if (rules.length === 0) return null

  const orGroups: Filter[] = []
  let currentGroup: Filter = {}

  for (const rule of rules) {
    const isOr = rule.logicalOperator === 'or'
    const ruleValue = toRuleValue(rule.operator, rule.value)

    if (isOr && Object.keys(currentGroup).length > 0) {
      orGroups.push({ ...currentGroup })
      currentGroup = {}
    }

    currentGroup[rule.column] = ruleValue as Filter[string]
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
    id: nanoid(),
    column,
    direction: normalizeSortDirection(direction),
  }))
}

function toRuleValue(operator: string, value: string): JsonValue {
  const parsedValue = parseValue(value, operator)
  return operator === 'eq' ? parsedValue : { [`$${operator}`]: parsedValue }
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

function parseValue(value: string, operator: string): JsonValue {
  if (operator === 'in') {
    return value
      .split(',')
      .map((part) => part.trim())
      .map((part) => parseScalar(part))
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

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [op, opValue] of Object.entries(value)) {
        if (op.startsWith('$')) {
          rules.push({
            id: nanoid(),
            logicalOperator: 'and',
            column,
            operator: op.substring(1),
            value: formatValueForBuilder(opValue as JsonValue),
          })
        }
      }
      continue
    }

    rules.push({
      id: nanoid(),
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
