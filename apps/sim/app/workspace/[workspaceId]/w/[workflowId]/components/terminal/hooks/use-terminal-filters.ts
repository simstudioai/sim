import { useCallback, useMemo, useState } from 'react'
import type { ConsoleEntry } from '@/stores/terminal'

/**
 * Sort configuration
 */
export type SortField = 'timestamp'
export type SortDirection = 'asc' | 'desc'

export interface SortConfig {
  field: SortField
  direction: SortDirection
}

/**
 * Filter configuration state
 */
export interface TerminalFilters {
  blockIds: Set<string>
  statuses: Set<'error' | 'info'>
  runIds: Set<string>
}

/**
 * Custom hook to manage terminal filters and sorting.
 * Provides filter state, sort state, and filtering/sorting logic for console entries.
 *
 * @returns Filter state, sort state, and handlers
 */
export function useTerminalFilters() {
  const [filters, setFilters] = useState<TerminalFilters>({
    blockIds: new Set(),
    statuses: new Set(),
    runIds: new Set(),
  })

  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'timestamp',
    direction: 'desc',
  })

  /**
   * Toggles a block filter by block ID
   */
  const toggleBlock = useCallback((blockId: string) => {
    setFilters((prev) => {
      const newBlockIds = new Set(prev.blockIds)
      if (newBlockIds.has(blockId)) {
        newBlockIds.delete(blockId)
      } else {
        newBlockIds.add(blockId)
      }
      return { ...prev, blockIds: newBlockIds }
    })
  }, [])

  /**
   * Toggles a status filter
   */
  const toggleStatus = useCallback((status: 'error' | 'info') => {
    setFilters((prev) => {
      const newStatuses = new Set(prev.statuses)
      if (newStatuses.has(status)) {
        newStatuses.delete(status)
      } else {
        newStatuses.add(status)
      }
      return { ...prev, statuses: newStatuses }
    })
  }, [])

  /**
   * Toggles a run ID filter
   */
  const toggleRunId = useCallback((runId: string) => {
    setFilters((prev) => {
      const newRunIds = new Set(prev.runIds)
      if (newRunIds.has(runId)) {
        newRunIds.delete(runId)
      } else {
        newRunIds.add(runId)
      }
      return { ...prev, runIds: newRunIds }
    })
  }, [])

  /**
   * Toggles sort direction between ascending and descending
   */
  const toggleSort = useCallback(() => {
    setSortConfig((prev) => ({
      field: prev.field,
      direction: prev.direction === 'desc' ? 'asc' : 'desc',
    }))
  }, [])

  /**
   * Clears all filters
   */
  const clearFilters = useCallback(() => {
    setFilters({
      blockIds: new Set(),
      statuses: new Set(),
      runIds: new Set(),
    })
  }, [])

  /**
   * Checks if any filters are active
   */
  const hasActiveFilters = useMemo(() => {
    return filters.blockIds.size > 0 || filters.statuses.size > 0 || filters.runIds.size > 0
  }, [filters])

  /**
   * Filters and sorts console entries based on current filter and sort state
   */
  const filterEntries = useCallback(
    (entries: ConsoleEntry[]): ConsoleEntry[] => {
      // Apply filters first
      let result = entries

      if (hasActiveFilters) {
        result = entries.filter((entry) => {
          // Block ID filter
          if (filters.blockIds.size > 0 && !filters.blockIds.has(entry.blockId)) {
            return false
          }

          // Status filter
          if (filters.statuses.size > 0) {
            const isError = !!entry.error
            const hasStatus = isError ? filters.statuses.has('error') : filters.statuses.has('info')
            if (!hasStatus) return false
          }

          // Run ID filter
          if (
            filters.runIds.size > 0 &&
            (!entry.executionId || !filters.runIds.has(entry.executionId))
          ) {
            return false
          }

          return true
        })
      }

      // Apply sorting by timestamp
      result = [...result].sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime()
        const timeB = new Date(b.timestamp).getTime()
        const comparison = timeA - timeB
        return sortConfig.direction === 'asc' ? comparison : -comparison
      })

      return result
    },
    [filters, hasActiveFilters, sortConfig]
  )

  return {
    filters,
    sortConfig,
    toggleBlock,
    toggleStatus,
    toggleRunId,
    toggleSort,
    clearFilters,
    hasActiveFilters,
    filterEntries,
  }
}
