import { document, embedding } from '@sim/db/schema'
import { and, eq, gt, gte, ilike, lt, lte, ne, not, or, type SQL } from 'drizzle-orm'
import type {
  BooleanFilterCondition,
  DateFilterCondition,
  FilterCondition,
  FilterGroup,
  NumberFilterCondition,
  SimpleTagFilter,
  TagFilter,
  TextFilterCondition,
} from './types'

/**
 * Valid tag slots that can be used in filters
 */
const VALID_TEXT_SLOTS = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const
const VALID_NUMBER_SLOTS = ['number1', 'number2', 'number3', 'number4', 'number5'] as const
const VALID_DATE_SLOTS = ['date1', 'date2'] as const
const VALID_BOOLEAN_SLOTS = ['boolean1', 'boolean2', 'boolean3'] as const

type TextSlot = (typeof VALID_TEXT_SLOTS)[number]
type NumberSlot = (typeof VALID_NUMBER_SLOTS)[number]
type DateSlot = (typeof VALID_DATE_SLOTS)[number]
type BooleanSlot = (typeof VALID_BOOLEAN_SLOTS)[number]

/**
 * Validates that a tag slot is valid for the given field type
 */
function isValidSlotForType(
  slot: string,
  fieldType: string
): slot is TextSlot | NumberSlot | DateSlot | BooleanSlot {
  switch (fieldType) {
    case 'text':
      return (VALID_TEXT_SLOTS as readonly string[]).includes(slot)
    case 'number':
      return (VALID_NUMBER_SLOTS as readonly string[]).includes(slot)
    case 'date':
      return (VALID_DATE_SLOTS as readonly string[]).includes(slot)
    case 'boolean':
      return (VALID_BOOLEAN_SLOTS as readonly string[]).includes(slot)
    default:
      return false
  }
}

/**
 * Build SQL condition for a text filter
 */
function buildTextCondition(
  condition: TextFilterCondition,
  table: typeof document | typeof embedding
): SQL | null {
  const { tagSlot, operator, value } = condition

  if (!isValidSlotForType(tagSlot, 'text')) {
    return null
  }

  const column = table[tagSlot as TextSlot]
  if (!column) return null

  switch (operator) {
    case 'eq':
      return eq(column, value)
    case 'neq':
      return ne(column, value)
    case 'contains':
      return ilike(column, `%${value}%`)
    case 'not_contains':
      return not(ilike(column, `%${value}%`))
    case 'starts_with':
      return ilike(column, `${value}%`)
    case 'ends_with':
      return ilike(column, `%${value}`)
    default:
      return null
  }
}

/**
 * Build SQL condition for a number filter
 */
function buildNumberCondition(
  condition: NumberFilterCondition,
  table: typeof document | typeof embedding
): SQL | null {
  const { tagSlot, operator, value, valueTo } = condition

  if (!isValidSlotForType(tagSlot, 'number')) {
    return null
  }

  const column = table[tagSlot as NumberSlot]
  if (!column) return null

  switch (operator) {
    case 'eq':
      return eq(column, value)
    case 'neq':
      return ne(column, value)
    case 'gt':
      return gt(column, value)
    case 'gte':
      return gte(column, value)
    case 'lt':
      return lt(column, value)
    case 'lte':
      return lte(column, value)
    case 'between':
      if (valueTo !== undefined) {
        return and(gte(column, value), lte(column, valueTo)) ?? null
      }
      return null
    default:
      return null
  }
}

/**
 * Parse a YYYY-MM-DD date string into a UTC Date object.
 */
function parseDateValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * Build SQL condition for a date filter.
 * Expects date values in YYYY-MM-DD format.
 */
function buildDateCondition(
  condition: DateFilterCondition,
  table: typeof document | typeof embedding
): SQL | null {
  const { tagSlot, operator, value, valueTo } = condition

  if (!isValidSlotForType(tagSlot, 'date')) {
    return null
  }

  const column = table[tagSlot as DateSlot]
  if (!column) return null

  const dateValue = parseDateValue(value)
  if (!dateValue) return null

  switch (operator) {
    case 'eq':
      return eq(column, dateValue)
    case 'neq':
      return ne(column, dateValue)
    case 'gt':
      return gt(column, dateValue)
    case 'gte':
      return gte(column, dateValue)
    case 'lt':
      return lt(column, dateValue)
    case 'lte':
      return lte(column, dateValue)
    case 'between':
      if (valueTo !== undefined) {
        const dateValueTo = parseDateValue(valueTo)
        if (!dateValueTo) return null
        return and(gte(column, dateValue), lte(column, dateValueTo)) ?? null
      }
      return null
    default:
      return null
  }
}

/**
 * Build SQL condition for a boolean filter
 */
function buildBooleanCondition(
  condition: BooleanFilterCondition,
  table: typeof document | typeof embedding
): SQL | null {
  const { tagSlot, operator, value } = condition

  if (!isValidSlotForType(tagSlot, 'boolean')) {
    return null
  }

  const column = table[tagSlot as BooleanSlot]
  if (!column) return null

  switch (operator) {
    case 'eq':
      return eq(column, value)
    case 'neq':
      return ne(column, value)
    default:
      return null
  }
}

/**
 * Build SQL condition for a single filter condition
 */
function buildCondition(
  condition: FilterCondition,
  table: typeof document | typeof embedding
): SQL | null {
  switch (condition.fieldType) {
    case 'text':
      return buildTextCondition(condition, table)
    case 'number':
      return buildNumberCondition(condition, table)
    case 'date':
      return buildDateCondition(condition, table)
    case 'boolean':
      return buildBooleanCondition(condition, table)
    default:
      return null
  }
}

/**
 * Build SQL condition for a filter group
 */
function buildGroupCondition(
  group: FilterGroup,
  table: typeof document | typeof embedding
): SQL | null {
  const conditions = group.conditions
    .map((condition) => buildCondition(condition, table))
    .filter((c): c is SQL => c !== null)

  if (conditions.length === 0) {
    return null
  }

  if (conditions.length === 1) {
    return conditions[0]
  }

  return (group.operator === 'AND' ? and(...conditions) : or(...conditions)) ?? null
}

/**
 * Build SQL WHERE clause from a TagFilter
 * Supports nested groups with AND/OR logic
 */
export function buildTagFilterQuery(
  filter: TagFilter,
  table: typeof document | typeof embedding
): SQL | null {
  const groupConditions = filter.groups
    .map((group) => buildGroupCondition(group, table))
    .filter((c): c is SQL => c !== null)

  if (groupConditions.length === 0) {
    return null
  }

  if (groupConditions.length === 1) {
    return groupConditions[0]
  }

  return (filter.rootOperator === 'AND' ? and(...groupConditions) : or(...groupConditions)) ?? null
}

/**
 * Build SQL WHERE clause from a SimpleTagFilter
 * For flat filter structures without nested groups
 */
export function buildSimpleTagFilterQuery(
  filter: SimpleTagFilter,
  table: typeof document | typeof embedding
): SQL | null {
  const conditions = filter.conditions
    .map((condition) => buildCondition(condition, table))
    .filter((c): c is SQL => c !== null)

  if (conditions.length === 0) {
    return null
  }

  if (conditions.length === 1) {
    return conditions[0]
  }

  return (filter.operator === 'AND' ? and(...conditions) : or(...conditions)) ?? null
}

/**
 * Build SQL WHERE clause from an array of filter conditions
 * Combines all conditions with AND by default
 */
export function buildFilterConditionsQuery(
  conditions: FilterCondition[],
  table: typeof document | typeof embedding,
  operator: 'AND' | 'OR' = 'AND'
): SQL | null {
  return buildSimpleTagFilterQuery({ operator, conditions }, table)
}

/**
 * Convenience function to build filter for document table
 */
export function buildDocumentFilterQuery(filter: TagFilter | SimpleTagFilter): SQL | null {
  if ('rootOperator' in filter) {
    return buildTagFilterQuery(filter, document)
  }
  return buildSimpleTagFilterQuery(filter, document)
}

/**
 * Convenience function to build filter for embedding table
 */
export function buildEmbeddingFilterQuery(filter: TagFilter | SimpleTagFilter): SQL | null {
  if ('rootOperator' in filter) {
    return buildTagFilterQuery(filter, embedding)
  }
  return buildSimpleTagFilterQuery(filter, embedding)
}

/**
 * Validate a filter condition
 * Returns an array of validation errors, empty if valid
 */
export function validateFilterCondition(condition: FilterCondition): string[] {
  const errors: string[] = []

  if (!isValidSlotForType(condition.tagSlot, condition.fieldType)) {
    errors.push(`Invalid tag slot "${condition.tagSlot}" for field type "${condition.fieldType}"`)
  }

  switch (condition.fieldType) {
    case 'text':
      if (typeof condition.value !== 'string') {
        errors.push('Text filter value must be a string')
      }
      break
    case 'number':
      if (typeof condition.value !== 'number' || Number.isNaN(condition.value)) {
        errors.push('Number filter value must be a valid number')
      }
      if (condition.operator === 'between' && condition.valueTo === undefined) {
        errors.push('Between operator requires a second value')
      }
      if (condition.valueTo !== undefined && typeof condition.valueTo !== 'number') {
        errors.push('Number filter second value must be a valid number')
      }
      break
    case 'date':
      if (typeof condition.value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(condition.value)) {
        errors.push('Date filter value must be in YYYY-MM-DD format')
      }
      if (condition.operator === 'between' && condition.valueTo === undefined) {
        errors.push('Between operator requires a second value')
      }
      if (
        condition.valueTo !== undefined &&
        (typeof condition.valueTo !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(condition.valueTo))
      ) {
        errors.push('Date filter second value must be in YYYY-MM-DD format')
      }
      break
    case 'boolean':
      if (typeof condition.value !== 'boolean') {
        errors.push('Boolean filter value must be true or false')
      }
      break
  }

  return errors
}

/**
 * Validate all conditions in a filter
 */
export function validateFilter(filter: TagFilter | SimpleTagFilter): string[] {
  const errors: string[] = []

  if ('rootOperator' in filter) {
    for (const group of filter.groups) {
      for (const condition of group.conditions) {
        errors.push(...validateFilterCondition(condition))
      }
    }
  } else {
    for (const condition of filter.conditions) {
      errors.push(...validateFilterCondition(condition))
    }
  }

  return errors
}
