/**
 * Filter operators for different field types
 */

/**
 * Text filter operators
 */
export type TextOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'

/**
 * Number filter operators
 */
export type NumberOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'

/**
 * Date filter operators
 */
export type DateOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'

/**
 * Boolean filter operators
 */
export type BooleanOperator = 'eq' | 'neq'

/**
 * All filter operators union
 */
export type FilterOperator = TextOperator | NumberOperator | DateOperator | BooleanOperator

/**
 * Field types supported for filtering
 */
export type FilterFieldType = 'text' | 'number' | 'date' | 'boolean'

/**
 * Logical operators for combining filters
 */
export type LogicalOperator = 'AND' | 'OR'

/**
 * Base filter condition interface
 */
interface BaseFilterCondition {
  tagSlot: string
  fieldType: FilterFieldType
}

/**
 * Text filter condition
 */
interface TextFilterCondition extends BaseFilterCondition {
  fieldType: 'text'
  operator: TextOperator
  value: string
}

/**
 * Number filter condition
 */
interface NumberFilterCondition extends BaseFilterCondition {
  fieldType: 'number'
  operator: NumberOperator
  value: number
  valueTo?: number // For 'between' operator
}

/**
 * Date filter condition
 */
interface DateFilterCondition extends BaseFilterCondition {
  fieldType: 'date'
  operator: DateOperator
  value: string // ISO date string
  valueTo?: string // For 'between' operator (ISO date string)
}

/**
 * Boolean filter condition
 */
interface BooleanFilterCondition extends BaseFilterCondition {
  fieldType: 'boolean'
  operator: BooleanOperator
  value: boolean
}

/**
 * Union of all filter conditions
 */
export type FilterCondition =
  | TextFilterCondition
  | NumberFilterCondition
  | DateFilterCondition
  | BooleanFilterCondition

/**
 * Filter group with logical operator
 */
interface FilterGroup {
  operator: LogicalOperator
  conditions: FilterCondition[]
}

/**
 * Complete filter query structure
 * Supports nested groups with AND/OR logic
 */
interface TagFilter {
  rootOperator: LogicalOperator
  groups: FilterGroup[]
}

/**
 * Simplified flat filter structure for simple use cases
 */
interface SimpleTagFilter {
  operator: LogicalOperator
  conditions: FilterCondition[]
}

/**
 * Operator metadata for UI display
 */
export interface OperatorInfo {
  value: string
  label: string
  requiresSecondValue?: boolean
}

/**
 * Text operators metadata
 */
export const TEXT_OPERATORS: OperatorInfo[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
]

/**
 * Number operators metadata
 */
export const NUMBER_OPERATORS: OperatorInfo[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater than or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less than or equal' },
  { value: 'between', label: 'between', requiresSecondValue: true },
]

/**
 * Date operators metadata
 */
export const DATE_OPERATORS: OperatorInfo[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'gt', label: 'after' },
  { value: 'gte', label: 'on or after' },
  { value: 'lt', label: 'before' },
  { value: 'lte', label: 'on or before' },
  { value: 'between', label: 'between', requiresSecondValue: true },
]

/**
 * Boolean operators metadata
 */
export const BOOLEAN_OPERATORS: OperatorInfo[] = [
  { value: 'eq', label: 'is' },
  { value: 'neq', label: 'is not' },
]

/**
 * Get operators for a field type
 */
export function getOperatorsForFieldType(fieldType: FilterFieldType): OperatorInfo[] {
  switch (fieldType) {
    case 'text':
      return TEXT_OPERATORS
    case 'number':
      return NUMBER_OPERATORS
    case 'date':
      return DATE_OPERATORS
    case 'boolean':
      return BOOLEAN_OPERATORS
    default:
      return []
  }
}

/** Wire format for a date filter value (`YYYY-MM-DD`). */
const DATE_ONLY_VALUE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Whether a `YYYY-MM-DD` string is a real calendar date. The format regex alone
 * still admits impossible dates (`2026-02-30`, `2026-99-99`) that pass the
 * boundary and then make the document query's `::date` cast throw a 500; this
 * round-trips the parsed parts to reject them.
 */
function isRealCalendarDate(value: string): boolean {
  if (!DATE_ONLY_VALUE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

/**
 * Whether a raw filter value is usable for the given field type. Shared source
 * of truth so the API boundary can reject unusable values (e.g. `"abc"` for a
 * number, `"not-a-date"` for a date) instead of letting them be silently
 * dropped further down. Values arrive as strings from the filter UI.
 */
export function isValidFilterValue(fieldType: FilterFieldType, value: unknown): boolean {
  if (value === undefined || value === null) return false
  switch (fieldType) {
    case 'text':
      return typeof value === 'string' && value.length > 0
    case 'number':
      if (typeof value === 'number') return Number.isFinite(value)
      return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
    case 'date':
      return typeof value === 'string' && isRealCalendarDate(value)
    case 'boolean':
      return (
        typeof value === 'boolean' ||
        (typeof value === 'string' && ['true', 'false'].includes(value.trim().toLowerCase()))
      )
    default:
      return false
  }
}
