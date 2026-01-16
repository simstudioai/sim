/**
 * Shared utilities for filter builder UI components.
 */

import { nanoid } from 'nanoid'
import type { JsonValue } from '../types'
import type { FilterCondition, SortCondition } from './constants'

/**
 * Converts builder filter conditions to MongoDB-style filter object.
 *
 * @param conditions - Array of filter conditions from the builder UI
 * @returns Filter object or null if no conditions
 */
export function conditionsToFilter(
  conditions: FilterCondition[]
): Record<string, JsonValue> | null {
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
export function filterToConditions(filter: Record<string, JsonValue> | null): FilterCondition[] {
  if (!filter) return []

  if (filter.$or && Array.isArray(filter.$or)) {
    const groups = filter.$or
      .map((orGroup) => parseFilterGroup(orGroup as Record<string, JsonValue>))
      .filter((group) => group.length > 0)
    return applyLogicalOperators(groups)
  }

  return parseFilterGroup(filter)
}

/**
 * Converts builder sort conditions to sort object.
 *
 * @param conditions - Array of sort conditions from the builder UI
 * @returns Sort object or null if no conditions
 */
export function sortConditionsToSort(conditions: SortCondition[]): Record<string, string> | null {
  if (conditions.length === 0) return null

  const sort: Record<string, string> = {}
  for (const condition of conditions) {
    if (condition.column) {
      sort[condition.column] = condition.direction
    }
  }

  return Object.keys(sort).length > 0 ? sort : null
}

/**
 * Converts sort object to builder conditions.
 *
 * @param sort - Sort object to convert
 * @returns Array of sort conditions for the builder UI
 */
export function sortToConditions(sort: Record<string, string> | null): SortCondition[] {
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

function parseFilterGroup(group: Record<string, JsonValue>): FilterCondition[] {
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
            value: formatValueForBuilder(opValue),
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
      value: formatValueForBuilder(value),
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

function normalizeSortDirection(direction: string): 'asc' | 'desc' {
  return direction === 'desc' ? 'desc' : 'asc'
}
