/**
 * Shared utilities for filter builder UI components.
 *
 * @module lib/table/filters/filter-builder-utils
 */

// Re-export shared constants and types for backward compatibility
export {
  COMPARISON_OPERATORS,
  type FilterCondition,
  generateConditionId as generateId,
  LOGICAL_OPERATORS,
  SORT_DIRECTIONS,
  type SortCondition,
} from './filter-constants'

// Import for internal use
import { type FilterCondition, generateConditionId, type SortCondition } from './filter-constants'

// Use internal alias for generateConditionId
const generateId = generateConditionId

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * Parses a string value into its appropriate type based on the operator.
 *
 * @param value - String value to parse
 * @param operator - Operator being used (affects parsing for 'in')
 * @returns Parsed value (string, number, boolean, null, or array)
 */
function parseValue(value: string, operator: string): JsonValue {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (!Number.isNaN(Number(value)) && value !== '') return Number(value)

  if (operator === 'in') {
    return value.split(',').map((v) => {
      const trimmed = v.trim()
      if (trimmed === 'true') return true
      if (trimmed === 'false') return false
      if (trimmed === 'null') return null
      if (!Number.isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed)
      return trimmed
    })
  }

  return value
}

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
  let currentAndGroup: Record<string, JsonValue> = {}

  conditions.forEach((condition, index) => {
    const { column, operator, value } = condition
    const operatorKey = `$${operator}`
    const parsedValue = parseValue(value, operator)
    const conditionObj = operator === 'eq' ? parsedValue : { [operatorKey]: parsedValue }

    if (index === 0 || condition.logicalOperator === 'and') {
      currentAndGroup[column] = conditionObj
    } else if (condition.logicalOperator === 'or') {
      if (Object.keys(currentAndGroup).length > 0) {
        orGroups.push({ ...currentAndGroup })
      }
      currentAndGroup = { [column]: conditionObj }
    }
  })

  if (Object.keys(currentAndGroup).length > 0) {
    orGroups.push(currentAndGroup)
  }

  if (orGroups.length > 1) {
    return { $or: orGroups }
  }

  return orGroups[0] || null
}

/**
 * Converts MongoDB-style filter object to builder conditions.
 *
 * @param filter - Filter object to convert
 * @returns Array of filter conditions for the builder UI
 */
export function filterToConditions(filter: Record<string, JsonValue> | null): FilterCondition[] {
  if (!filter) return []

  const conditions: FilterCondition[] = []

  if (filter.$or && Array.isArray(filter.$or)) {
    filter.$or.forEach((orGroup, groupIndex) => {
      if (typeof orGroup !== 'object' || orGroup === null || Array.isArray(orGroup)) {
        return
      }
      const groupConditions = parseFilterGroup(orGroup as Record<string, JsonValue>)
      groupConditions.forEach((cond, condIndex) => {
        conditions.push({
          ...cond,
          logicalOperator:
            groupIndex === 0 && condIndex === 0
              ? 'and'
              : groupIndex > 0 && condIndex === 0
                ? 'or'
                : 'and',
        })
      })
    })
    return conditions
  }

  return parseFilterGroup(filter)
}

/**
 * Parses a single filter group containing AND conditions.
 *
 * @param group - Filter group object
 * @returns Array of filter conditions
 */
function parseFilterGroup(group: Record<string, JsonValue>): FilterCondition[] {
  const conditions: FilterCondition[] = []

  for (const [column, value] of Object.entries(group)) {
    if (column === '$or' || column === '$and') continue

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [op, opValue] of Object.entries(value)) {
        if (op.startsWith('$')) {
          conditions.push({
            id: generateId(),
            logicalOperator: 'and',
            column,
            operator: op.substring(1),
            value: formatValueForBuilder(opValue),
          })
        }
      }
    } else {
      conditions.push({
        id: generateId(),
        logicalOperator: 'and',
        column,
        operator: 'eq',
        value: formatValueForBuilder(value),
      })
    }
  }

  return conditions
}

/**
 * Formats a value for display in the builder UI.
 *
 * @param value - Value to format
 * @returns String representation for the builder
 */
function formatValueForBuilder(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(formatValueForBuilder).join(', ')
  return String(value)
}

/**
 * Converts builder conditions to JSON string.
 *
 * @param conditions - Array of filter conditions
 * @returns JSON string representation
 */
export function conditionsToJsonString(conditions: FilterCondition[]): string {
  const filter = conditionsToFilter(conditions)
  if (!filter) return ''
  return JSON.stringify(filter, null, 2)
}

/**
 * Converts JSON string to builder conditions.
 *
 * @param jsonString - JSON string to parse
 * @returns Array of filter conditions or empty array if invalid
 */
export function jsonStringToConditions(jsonString: string): FilterCondition[] {
  if (!jsonString || !jsonString.trim()) return []

  try {
    const filter = JSON.parse(jsonString)
    return filterToConditions(filter)
  } catch {
    return []
  }
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
    id: generateId(),
    column,
    direction: direction === 'desc' ? 'desc' : 'asc',
  }))
}

/**
 * Converts builder sort conditions to JSON string.
 *
 * @param conditions - Array of sort conditions
 * @returns JSON string representation
 */
export function sortConditionsToJsonString(conditions: SortCondition[]): string {
  const sort = sortConditionsToSort(conditions)
  if (!sort) return ''
  return JSON.stringify(sort, null, 2)
}

/**
 * Converts JSON string to sort builder conditions.
 *
 * @param jsonString - JSON string to parse
 * @returns Array of sort conditions or empty array if invalid
 */
export function jsonStringToSortConditions(jsonString: string): SortCondition[] {
  if (!jsonString || !jsonString.trim()) return []

  try {
    const sort = JSON.parse(jsonString)
    return sortToConditions(sort)
  } catch {
    return []
  }
}
