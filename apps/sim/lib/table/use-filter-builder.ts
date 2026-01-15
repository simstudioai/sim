/**
 * Hook for filter builder functionality.
 *
 * Provides reusable filter condition management logic shared between
 * the table data viewer's FilterBuilder and workflow block's FilterFormat.
 *
 * @module lib/table/use-filter-builder
 */

import { useCallback, useMemo } from 'react'
import {
  COMPARISON_OPERATORS,
  type FilterCondition,
  generateConditionId,
  LOGICAL_OPERATORS,
  SORT_DIRECTIONS,
  type SortCondition,
} from './filter-constants'

/**
 * Column option for dropdowns.
 */
export interface ColumnOption {
  value: string
  label: string
}

/**
 * Props for the useFilterBuilder hook.
 */
export interface UseFilterBuilderProps {
  /** Available columns for filtering */
  columns: ColumnOption[]
  /** Current filter conditions */
  conditions: FilterCondition[]
  /** Setter function for updating conditions */
  setConditions: (conditions: FilterCondition[]) => void
  /** Whether the builder is read-only */
  isReadOnly?: boolean
}

/**
 * Return type for the useFilterBuilder hook.
 */
export interface UseFilterBuilderReturn {
  /** Memoized comparison operator options */
  comparisonOptions: ColumnOption[]
  /** Memoized logical operator options */
  logicalOptions: ColumnOption[]
  /** Memoized sort direction options */
  sortDirectionOptions: ColumnOption[]
  /** Adds a new filter condition */
  addCondition: () => void
  /** Removes a filter condition by ID */
  removeCondition: (id: string) => void
  /** Updates a specific field of a condition */
  updateCondition: (id: string, field: keyof FilterCondition, value: string) => void
  /** Creates a default condition (for external use) */
  createDefaultCondition: () => FilterCondition
}

/**
 * Hook that provides filter builder logic for managing filter conditions.
 *
 * @example Basic usage with useState:
 * ```tsx
 * const [conditions, setConditions] = useState<FilterCondition[]>([])
 *
 * const {
 *   comparisonOptions,
 *   logicalOptions,
 *   addCondition,
 *   removeCondition,
 *   updateCondition,
 * } = useFilterBuilder({
 *   columns: columnOptions,
 *   conditions,
 *   setConditions,
 * })
 * ```
 *
 * @example With store value:
 * ```tsx
 * const [conditions, setConditions] = useSubBlockValue<FilterCondition[]>(blockId, subBlockId)
 *
 * const { addCondition, removeCondition, updateCondition } = useFilterBuilder({
 *   columns,
 *   conditions: conditions ?? [],
 *   setConditions,
 *   isReadOnly: isPreview || disabled,
 * })
 * ```
 */
export function useFilterBuilder({
  columns,
  conditions,
  setConditions,
  isReadOnly = false,
}: UseFilterBuilderProps): UseFilterBuilderReturn {
  // Memoized options for dropdowns
  const comparisonOptions = useMemo(
    () => COMPARISON_OPERATORS.map((op) => ({ value: op.value, label: op.label })),
    []
  )

  const logicalOptions = useMemo(
    () => LOGICAL_OPERATORS.map((op) => ({ value: op.value, label: op.label })),
    []
  )

  const sortDirectionOptions = useMemo(
    () => SORT_DIRECTIONS.map((d) => ({ value: d.value, label: d.label })),
    []
  )

  /**
   * Creates a new filter condition with default values.
   */
  const createDefaultCondition = useCallback((): FilterCondition => {
    return {
      id: generateConditionId(),
      logicalOperator: 'and',
      column: columns[0]?.value || '',
      operator: 'eq',
      value: '',
    }
  }, [columns])

  /**
   * Adds a new filter condition.
   */
  const addCondition = useCallback(() => {
    if (isReadOnly) return
    setConditions([...conditions, createDefaultCondition()])
  }, [isReadOnly, conditions, setConditions, createDefaultCondition])

  /**
   * Removes a filter condition by ID.
   */
  const removeCondition = useCallback(
    (id: string) => {
      if (isReadOnly) return
      setConditions(conditions.filter((c) => c.id !== id))
    },
    [isReadOnly, conditions, setConditions]
  )

  /**
   * Updates a specific field of a condition.
   */
  const updateCondition = useCallback(
    (id: string, field: keyof FilterCondition, value: string) => {
      if (isReadOnly) return
      setConditions(conditions.map((c) => (c.id === id ? { ...c, [field]: value } : c)))
    },
    [isReadOnly, conditions, setConditions]
  )

  return {
    comparisonOptions,
    logicalOptions,
    sortDirectionOptions,
    addCondition,
    removeCondition,
    updateCondition,
    createDefaultCondition,
  }
}

/**
 * Props for sort configuration management.
 */
export interface UseSortBuilderProps {
  /** Available columns for sorting */
  columns: ColumnOption[]
  /** Current sort condition */
  sortCondition: SortCondition | null
  /** Setter function for updating sort */
  setSortCondition: (sort: SortCondition | null) => void
}

/**
 * Return type for the useSortBuilder hook.
 */
export interface UseSortBuilderReturn {
  /** Memoized sort direction options */
  sortDirectionOptions: ColumnOption[]
  /** Adds a sort configuration */
  addSort: () => void
  /** Removes the sort configuration */
  removeSort: () => void
  /** Updates the sort column */
  updateSortColumn: (column: string) => void
  /** Updates the sort direction */
  updateSortDirection: (direction: 'asc' | 'desc') => void
}

/**
 * Hook that provides sort builder logic.
 *
 * @example
 * ```tsx
 * const [sortCondition, setSortCondition] = useState<SortCondition | null>(null)
 *
 * const { addSort, removeSort, updateSortColumn, updateSortDirection } = useSortBuilder({
 *   columns: columnOptions,
 *   sortCondition,
 *   setSortCondition,
 * })
 * ```
 */
export function useSortBuilder({
  columns,
  sortCondition,
  setSortCondition,
}: UseSortBuilderProps): UseSortBuilderReturn {
  const sortDirectionOptions = useMemo(
    () => SORT_DIRECTIONS.map((d) => ({ value: d.value, label: d.label })),
    []
  )

  const addSort = useCallback(() => {
    setSortCondition({
      id: generateConditionId(),
      column: columns[0]?.value || '',
      direction: 'asc',
    })
  }, [columns, setSortCondition])

  const removeSort = useCallback(() => {
    setSortCondition(null)
  }, [setSortCondition])

  const updateSortColumn = useCallback(
    (column: string) => {
      if (sortCondition) {
        setSortCondition({ ...sortCondition, column })
      }
    },
    [sortCondition, setSortCondition]
  )

  const updateSortDirection = useCallback(
    (direction: 'asc' | 'desc') => {
      if (sortCondition) {
        setSortCondition({ ...sortCondition, direction })
      }
    },
    [sortCondition, setSortCondition]
  )

  return {
    sortDirectionOptions,
    addSort,
    removeSort,
    updateSortColumn,
    updateSortDirection,
  }
}
