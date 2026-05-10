/**
 * Filter operators for different field types
 */

/**
 * Text filter operators
 */
type TextOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'

/**
 * Number filter operators
 */
type NumberOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'

/**
 * Date filter operators
 */
type DateOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'

/**
 * Boolean filter operators
 */
type BooleanOperator = 'eq' | 'neq'

/**
 * All filter operators union
 */
type FilterOperator = TextOperator | NumberOperator | DateOperator | BooleanOperator

/**
 * Field types supported for filtering
 */
export type FilterFieldType = 'text' | 'number' | 'date' | 'boolean'

/**
 * Logical operators for combining filters
 */
type LogicalOperator = 'AND' | 'OR'

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
type FilterCondition =
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
const TEXT_OPERATORS: OperatorInfo[] = [
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
const NUMBER_OPERATORS: OperatorInfo[] = [
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
const DATE_OPERATORS: OperatorInfo[] = [
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
const BOOLEAN_OPERATORS: OperatorInfo[] = [
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
