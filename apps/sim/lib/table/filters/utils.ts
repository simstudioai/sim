/**
 * Shared utilities for filter builder UI components.
 *
 * These utilities convert between UI builder types (FilterCondition, SortCondition)
 * and API types (Filter, Sort).
 */

import { nanoid } from 'nanoid'
import type {
  Filter,
  FilterCondition,
  JsonValue,
  Sort,
  SortCondition,
  SortDirection,
} from '../types'

/**
 * Converts builder filter conditions to MongoDB-style filter object.
 *
 * @param conditions - Array of filter conditions from the builder UI
 * @returns Filter object or null if no conditions
 */
export function conditionsToFilter(conditions: FilterCondition[]): Filter | null {
  if (conditions.length === 0) return null

  const orGroups: Record<string, JsonValue>[] = []
  let currentGroup: Record<string, JsonValue> = {}

  for (const condition of conditions) {
    const isOr = condition.logicalOperator === 'or'
    const conditionValue = toConditionValue(condition.operator, condition.value)

    if (isOr && Object.keys(currentGroup).length > 0) {
      orGroups.push({ ...currentGroup })
      currentGroup = {}
    }

    currentGroup[condition.column] = conditionValue
  }

  if (Object.keys(currentGroup).length > 0) {
    orGroups.push(currentGroup)
  }

  return orGroups.length > 1 ? { $or: orGroups } : orGroups[0] || null
}

/**
 * Converts MongoDB-style filter object to builder conditions.
 *
 * @param filter - Filter object to convert
 * @returns Array of filter conditions for the builder UI
 */
export function filterToConditions(filter: Filter | null): FilterCondition[] {
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
 * Converts a single builder sort condition to Sort object.
 *
 * @param condition - Single sort condition from the builder UI
 * @returns Sort object or null if no condition
 */
export function sortConditionToSort(condition: SortCondition | null): Sort | null {
  if (!condition || !condition.column) return null
  return { [condition.column]: condition.direction }
}

/**
 * Converts builder sort conditions (array) to Sort object.
 *
 * @param conditions - Array of sort conditions from the builder UI
 * @returns Sort object or null if no conditions
 */
export function sortConditionsToSort(conditions: SortCondition[]): Sort | null {
  if (conditions.length === 0) return null

  const sort: Sort = {}
  for (const condition of conditions) {
    if (condition.column) {
      sort[condition.column] = condition.direction
    }
  }

  return Object.keys(sort).length > 0 ? sort : null
}

/**
 * Converts Sort object to builder conditions.
 *
 * @param sort - Sort object to convert
 * @returns Array of sort conditions for the builder UI
 */
export function sortToConditions(sort: Sort | null): SortCondition[] {
  if (!sort) return []

  return Object.entries(sort).map(([column, direction]) => ({
    id: nanoid(),
    column,
    direction: normalizeSortDirection(direction),
  }))
}

function toConditionValue(operator: string, value: string): JsonValue {
  const parsedValue = parseValue(value, operator)
  return operator === 'eq' ? parsedValue : { [`$${operator}`]: parsedValue }
}

function applyLogicalOperators(groups: FilterCondition[][]): FilterCondition[] {
  const conditions: FilterCondition[] = []

  groups.forEach((group, groupIndex) => {
    group.forEach((condition, conditionIndex) => {
      conditions.push({
        ...condition,
        logicalOperator:
          groupIndex === 0 && conditionIndex === 0
            ? 'and'
            : groupIndex > 0 && conditionIndex === 0
              ? 'or'
              : 'and',
      })
    })
  })

  return conditions
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

function parseFilterGroup(group: Filter): FilterCondition[] {
  if (!group || typeof group !== 'object' || Array.isArray(group)) return []

  const conditions: FilterCondition[] = []

  for (const [column, value] of Object.entries(group)) {
    if (column === '$or' || column === '$and') continue

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [op, opValue] of Object.entries(value)) {
        if (op.startsWith('$')) {
          conditions.push({
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

    conditions.push({
      id: nanoid(),
      logicalOperator: 'and',
      column,
      operator: 'eq',
      value: formatValueForBuilder(value as JsonValue),
    })
  }

  return conditions
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
