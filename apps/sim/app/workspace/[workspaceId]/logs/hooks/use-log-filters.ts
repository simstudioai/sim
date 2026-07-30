'use client'

import { useCallback, useMemo } from 'react'
import { useQueryStates } from 'nuqs'
import {
  logFilterParsers,
  logFilterUrlKeys,
} from '@/app/workspace/[workspaceId]/logs/search-params'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import type { LogLevel, TimeRange, TriggerType } from '@/stores/logs/filters/types'

const DEFAULT_TIME_RANGE: TimeRange = 'All time'

/**
 * The logs filter state, sourced entirely from typed URL query params via nuqs.
 *
 * This replaces the former hand-rolled `useFilterStore` URL sync (`syncWithURL`
 * / `initializeFromURL` / `popstate`). The URL is now the single source of
 * truth — initialization, serialization, and back/forward navigation are all
 * handled by nuqs. The action surface mirrors the previous store so consumers
 * migrate with minimal churn.
 */
export interface UseLogFilters {
  timeRange: TimeRange
  startDate: string | undefined
  endDate: string | undefined
  level: LogLevel
  workflowIds: string[]
  folderIds: string[]
  triggers: TriggerType[]
  searchQuery: string

  setTimeRange: (timeRange: TimeRange) => void
  setDateRange: (startDate: string | undefined, endDate: string | undefined) => void
  clearDateRange: () => void
  setLevel: (level: LogLevel) => void
  setWorkflowIds: (workflowIds: string[]) => void
  toggleWorkflowId: (workflowId: string) => void
  setFolderIds: (folderIds: string[]) => void
  toggleFolderId: (folderId: string) => void
  setSearchQuery: (query: string) => void
  setTriggers: (triggers: TriggerType[]) => void
  toggleTrigger: (trigger: TriggerType) => void
  resetFilters: () => void
}

/**
 * Hook exposing the logs filter state and actions backed by URL query params.
 * `startDate`/`endDate` are only retained while the time range is "Custom range"
 * to match the prior store semantics.
 */
export function useLogFilters(): UseLogFilters {
  const [filters, setFilters] = useQueryStates(logFilterParsers, logFilterUrlKeys)

  const setTimeRange = useCallback(
    (timeRange: TimeRange) => {
      if (timeRange === 'Custom range') {
        setFilters({ timeRange })
      } else {
        setFilters({ timeRange, startDate: null, endDate: null })
      }
    },
    [setFilters]
  )

  const setDateRange = useCallback(
    (startDate: string | undefined, endDate: string | undefined) => {
      setFilters({
        timeRange: 'Custom range',
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      })
    },
    [setFilters]
  )

  const clearDateRange = useCallback(() => {
    setFilters({ timeRange: DEFAULT_TIME_RANGE, startDate: null, endDate: null })
  }, [setFilters])

  const setLevel = useCallback((level: LogLevel) => setFilters({ level }), [setFilters])

  const setWorkflowIds = useCallback(
    (workflowIds: string[]) => setFilters({ workflowIds }),
    [setFilters]
  )

  const toggleWorkflowId = useCallback(
    (workflowId: string) => {
      setFilters((prev) => {
        const current = prev.workflowIds
        const next = current.includes(workflowId)
          ? current.filter((id) => id !== workflowId)
          : [...current, workflowId]
        return { workflowIds: next }
      })
    },
    [setFilters]
  )

  const setFolderIds = useCallback((folderIds: string[]) => setFilters({ folderIds }), [setFilters])

  const toggleFolderId = useCallback(
    (folderId: string) => {
      setFilters((prev) => {
        const current = prev.folderIds
        const next = current.includes(folderId)
          ? current.filter((id) => id !== folderId)
          : [...current, folderId]
        return { folderIds: next }
      })
    },
    [setFilters]
  )

  /**
   * Debounces only the search param's URL write; the returned `filters.search`
   * value still updates instantly so the controlled input stays responsive.
   * Writes the raw value (query consumers trim on read); clearing flushes
   * immediately so the param drops out without lingering.
   */
  const setSearchQuery = useDebouncedSearchSetter((value, options) =>
    setFilters({ search: value }, options)
  )

  const setTriggers = useCallback(
    (triggers: TriggerType[]) => setFilters({ triggers }),
    [setFilters]
  )

  const toggleTrigger = useCallback(
    (trigger: TriggerType) => {
      setFilters((prev) => {
        const current = prev.triggers
        const next = current.includes(trigger)
          ? current.filter((t) => t !== trigger)
          : [...current, trigger]
        return { triggers: next }
      })
    },
    [setFilters]
  )

  const resetFilters = useCallback(() => {
    setFilters({
      timeRange: DEFAULT_TIME_RANGE,
      startDate: null,
      endDate: null,
      level: 'all',
      workflowIds: [],
      folderIds: [],
      triggers: [],
      search: null,
    })
  }, [setFilters])

  return useMemo(
    () => ({
      timeRange: filters.timeRange,
      startDate:
        filters.timeRange === 'Custom range' ? (filters.startDate ?? undefined) : undefined,
      endDate: filters.timeRange === 'Custom range' ? (filters.endDate ?? undefined) : undefined,
      level: filters.level,
      workflowIds: filters.workflowIds,
      folderIds: filters.folderIds,
      triggers: filters.triggers,
      searchQuery: filters.search,
      setTimeRange,
      setDateRange,
      clearDateRange,
      setLevel,
      setWorkflowIds,
      toggleWorkflowId,
      setFolderIds,
      toggleFolderId,
      setSearchQuery,
      setTriggers,
      toggleTrigger,
      resetFilters,
    }),
    [
      filters,
      setTimeRange,
      setDateRange,
      clearDateRange,
      setLevel,
      setWorkflowIds,
      toggleWorkflowId,
      setFolderIds,
      toggleFolderId,
      setSearchQuery,
      setTriggers,
      toggleTrigger,
      resetFilters,
    ]
  )
}
