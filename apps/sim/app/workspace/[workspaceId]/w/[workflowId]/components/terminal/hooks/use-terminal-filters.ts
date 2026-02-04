import { useCallback, useMemo, useState } from 'react'
import type {
  SortConfig,
  TerminalFilters,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'
import type { ConsoleEntry } from '@/stores/terminal'

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
    })
  }, [])

  /**
   * Checks if any filters are active
   */
  const hasActiveFilters = useMemo(() => {
    return filters.blockIds.size > 0 || filters.statuses.size > 0
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

          return true
        })
      }

      // Sort by executionOrder (monotonically increasing integer from server)
      result = [...result].sort((a, b) => {
        const comparison = a.executionOrder - b.executionOrder
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
    toggleSort,
    clearFilters,
    hasActiveFilters,
    filterEntries,
  }
}
