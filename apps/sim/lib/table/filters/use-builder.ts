/**
 * Hooks for filter and sort builder UI state management.
 */

import { useCallback, useMemo } from 'react'
import { nanoid } from 'nanoid'
import type { ColumnOption } from '../types'
import {
  COMPARISON_OPERATORS,
  type FilterRule,
  LOGICAL_OPERATORS,
  SORT_DIRECTIONS,
  type SortRule,
} from './constants'

export type { ColumnOption }

/** Manages filter rule state with add/remove/update operations. */
export function useFilterBuilder({
  columns,
  rules,
  setRules,
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

  const createDefaultRule = useCallback((): FilterRule => {
    return {
      id: nanoid(),
      logicalOperator: 'and',
      column: columns[0]?.value || '',
      operator: 'eq',
      value: '',
    }
  }, [columns])

  const addRule = useCallback(() => {
    if (isReadOnly) return
    setRules([...rules, createDefaultRule()])
  }, [isReadOnly, rules, setRules, createDefaultRule])

  const removeRule = useCallback(
    (id: string) => {
      if (isReadOnly) return
      setRules(rules.filter((r) => r.id !== id))
    },
    [isReadOnly, rules, setRules]
  )

  const updateRule = useCallback(
    (id: string, field: keyof FilterRule, value: string) => {
      if (isReadOnly) return
      setRules(rules.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
    },
    [isReadOnly, rules, setRules]
  )

  return {
    comparisonOptions,
    logicalOptions,
    sortDirectionOptions,
    addRule,
    removeRule,
    updateRule,
    createDefaultRule,
  }
}

/** Manages sort rule state with add/remove/update operations. */
export function useSortBuilder({
  columns,
  sortRule,
  setSortRule,
}: UseSortBuilderProps): UseSortBuilderReturn {
  const sortDirectionOptions = useMemo(
    () => SORT_DIRECTIONS.map((d) => ({ value: d.value, label: d.label })),
    []
  )

  const addSort = useCallback(() => {
    setSortRule({
      id: nanoid(),
      column: columns[0]?.value || '',
      direction: 'asc',
    })
  }, [columns, setSortRule])

  const removeSort = useCallback(() => {
    setSortRule(null)
  }, [setSortRule])

  const updateSortColumn = useCallback(
    (column: string) => {
      if (sortRule) {
        setSortRule({ ...sortRule, column })
      }
    },
    [sortRule, setSortRule]
  )

  const updateSortDirection = useCallback(
    (direction: 'asc' | 'desc') => {
      if (sortRule) {
        setSortRule({ ...sortRule, direction })
      }
    },
    [sortRule, setSortRule]
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
  rules: FilterRule[]
  setRules: (rules: FilterRule[]) => void
  isReadOnly?: boolean
}

export interface UseFilterBuilderReturn {
  comparisonOptions: ColumnOption[]
  logicalOptions: ColumnOption[]
  sortDirectionOptions: ColumnOption[]
  addRule: () => void
  removeRule: (id: string) => void
  updateRule: (id: string, field: keyof FilterRule, value: string) => void
  createDefaultRule: () => FilterRule
}

export interface UseSortBuilderProps {
  columns: ColumnOption[]
  sortRule: SortRule | null
  setSortRule: (sort: SortRule | null) => void
}

export interface UseSortBuilderReturn {
  sortDirectionOptions: ColumnOption[]
  addSort: () => void
  removeSort: () => void
  updateSortColumn: (column: string) => void
  updateSortDirection: (direction: 'asc' | 'desc') => void
}
