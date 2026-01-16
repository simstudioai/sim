/**
 * Hook for filter builder functionality.
 *
 * Provides reusable filter condition management logic shared between
 * the table data viewer's TableQueryBuilder and workflow block's FilterFormat.
 */

import { useCallback, useMemo } from 'react'
import { nanoid } from 'nanoid'
import type { ColumnOption } from '../types'
import {
  COMPARISON_OPERATORS,
  type FilterCondition,
  LOGICAL_OPERATORS,
  SORT_DIRECTIONS,
  type SortCondition,
} from './constants'

// Re-export ColumnOption for consumers of this module
export type { ColumnOption }

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

  const createDefaultCondition = useCallback((): FilterCondition => {
    return {
      id: nanoid(),
      logicalOperator: 'and',
      column: columns[0]?.value || '',
      operator: 'eq',
      value: '',
    }
  }, [columns])

  const addCondition = useCallback(() => {
    if (isReadOnly) return
    setConditions([...conditions, createDefaultCondition()])
  }, [isReadOnly, conditions, setConditions, createDefaultCondition])

  const removeCondition = useCallback(
    (id: string) => {
      if (isReadOnly) return
      setConditions(conditions.filter((c) => c.id !== id))
    },
    [isReadOnly, conditions, setConditions]
  )

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
      id: nanoid(),
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

export interface UseFilterBuilderProps {
  columns: ColumnOption[]
  conditions: FilterCondition[]
  setConditions: (conditions: FilterCondition[]) => void
  isReadOnly?: boolean
}

export interface UseFilterBuilderReturn {
  comparisonOptions: ColumnOption[]
  logicalOptions: ColumnOption[]
  sortDirectionOptions: ColumnOption[]
  addCondition: () => void
  removeCondition: (id: string) => void
  updateCondition: (id: string, field: keyof FilterCondition, value: string) => void
  createDefaultCondition: () => FilterCondition
}

export interface UseSortBuilderProps {
  columns: ColumnOption[]
  sortCondition: SortCondition | null
  setSortCondition: (sort: SortCondition | null) => void
}

export interface UseSortBuilderReturn {
  sortDirectionOptions: ColumnOption[]
  addSort: () => void
  removeSort: () => void
  updateSortColumn: (column: string) => void
  updateSortDirection: (direction: 'asc' | 'desc') => void
}
