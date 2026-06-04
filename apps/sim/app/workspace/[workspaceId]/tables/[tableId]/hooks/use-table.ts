'use client'

import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDefinition, TableDefinition, TableRow, WorkflowGroup } from '@/lib/table'
import { TABLE_LIMITS } from '@/lib/table/constants'
import type { FlattenOutputsBlockInput } from '@/lib/workflows/blocks/flatten-outputs'
import { getBlock } from '@/blocks'
import {
  tableRowsInfiniteOptions,
  useInfiniteTableRows,
  useTable as useTableQuery,
} from '@/hooks/queries/tables'
import { useWorkflowStates, useWorkflows } from '@/hooks/queries/workflows'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import type { BlockIconInfo, ColumnSourceInfo } from '../components/table-grid/types'
import type { QueryOptions } from '../types'

const EMPTY_COLUMNS: ColumnDefinition[] = []
const EMPTY_GROUPS: WorkflowGroup[] = []

interface UseTableParams {
  workspaceId: string
  tableId: string
  queryOptions: QueryOptions
}

interface FetchNextPageResult {
  hasNextPage: boolean
}

export interface UseTableReturn {
  tableData: TableDefinition | undefined
  isLoadingTable: boolean
  /** Flattened across every fetched infinite-query page. */
  rows: TableRow[]
  isLoadingRows: boolean
  refetchRows: () => void
  /**
   * The resolved value's `hasNextPage` reflects the post-fetch cache state —
   * read from this rather than the hook's `hasNextPage`, which only updates on
   * the next React render.
   */
  fetchNextPage: () => Promise<FetchNextPageResult>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  workflows: WorkflowMetadata[] | undefined
  columns: ColumnDefinition[]
  tableWorkflowGroups: WorkflowGroup[]
  workflowStates: Map<string, WorkflowState | null>
  /** Headers read from this map instead of each subscribing to its own workflow-state query. */
  columnSourceInfo: Map<string, ColumnSourceInfo>
  /**
   * Fetches any missing pages then returns the full flat row list from cache.
   * Safe to read immediately — no React re-render required. Gate bulk ops that
   * need the complete row set behind this.
   */
  ensureAllRowsLoaded: () => Promise<TableRow[]>
  /**
   * Pages until the cache holds at least `maxRows` rows (or no more pages
   * exist), then returns the first `maxRows` from cache plus whether more
   * remain. Unlike {@link ensureAllRowsLoaded} it stops early, so size-bound
   * ops (clipboard copy) don't drain an entire large table. Filter/sort-aware.
   */
  ensureRowsLoadedUpTo: (maxRows: number) => Promise<{ rows: TableRow[]; hasMore: boolean }>
}

/**
 * Local interaction state (drag, resize, selection, editing) intentionally
 * stays in the `Table` component — moving it here would push every keystroke
 * through this hook's return value and re-render everything.
 */
export function useTable({ workspaceId, tableId, queryOptions }: UseTableParams): UseTableReturn {
  const queryClient = useQueryClient()
  const { data: tableData, isLoading: isLoadingTable } = useTableQuery(workspaceId, tableId)

  const {
    data: rowsData,
    isLoading: isLoadingRows,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteTableRows({
    workspaceId,
    tableId,
    pageSize: TABLE_LIMITS.MAX_QUERY_LIMIT,
    filter: queryOptions.filter,
    sort: queryOptions.sort,
    enabled: Boolean(workspaceId && tableId),
  })

  const rows = useMemo<TableRow[]>(
    () => rowsData?.pages.flatMap((p) => p.rows) ?? [],
    [rowsData?.pages]
  )

  const refetchRows = useCallback(() => {
    void refetch()
  }, [refetch])

  const ensureAllRowsLoaded = useCallback(async (): Promise<TableRow[]> => {
    if (!workspaceId || !tableId) return []

    const opts = tableRowsInfiniteOptions({
      workspaceId,
      tableId,
      pageSize: TABLE_LIMITS.MAX_QUERY_LIMIT,
      filter: queryOptions.filter,
      sort: queryOptions.sort,
    })

    // getQueryData bypasses React's render cycle — pages added by fetchNextPage
    // are visible synchronously after each await without waiting for a re-render.
    while (true) {
      const data = queryClient.getQueryData(opts.queryKey)
      const lastPage = data?.pages[data.pages.length - 1]
      if (!lastPage || lastPage.rows.length < TABLE_LIMITS.MAX_QUERY_LIMIT) break
      const result = await fetchNextPage()
      if (result.status === 'error') {
        throw result.error ?? new Error('Failed to load table rows')
      }
    }

    return queryClient.getQueryData(opts.queryKey)?.pages.flatMap((p) => p.rows) ?? []
  }, [workspaceId, tableId, queryOptions.filter, queryOptions.sort, queryClient, fetchNextPage])

  const ensureRowsLoadedUpTo = useCallback(
    async (maxRows: number): Promise<{ rows: TableRow[]; hasMore: boolean }> => {
      if (!workspaceId || !tableId) return { rows: [], hasMore: false }

      const opts = tableRowsInfiniteOptions({
        workspaceId,
        tableId,
        pageSize: TABLE_LIMITS.MAX_QUERY_LIMIT,
        filter: queryOptions.filter,
        sort: queryOptions.sort,
      })

      // Load one past the cap so `hasMore` is exact: a full final page only
      // *might* have a successor, so we confirm by loading row `maxRows + 1`
      // rather than inferring truncation from page fullness.
      while (true) {
        const data = queryClient.getQueryData(opts.queryKey)
        const loaded = data?.pages.reduce((sum, p) => sum + p.rows.length, 0) ?? 0
        if (loaded > maxRows) break
        const lastPage = data?.pages[data.pages.length - 1]
        if (!lastPage || lastPage.rows.length < TABLE_LIMITS.MAX_QUERY_LIMIT) break
        const result = await fetchNextPage()
        if (result.status === 'error') {
          throw result.error ?? new Error('Failed to load table rows')
        }
      }

      const all = queryClient.getQueryData(opts.queryKey)?.pages.flatMap((p) => p.rows) ?? []
      return {
        rows: all.length > maxRows ? all.slice(0, maxRows) : all,
        hasMore: all.length > maxRows,
      }
    },
    [workspaceId, tableId, queryOptions.filter, queryOptions.sort, queryClient, fetchNextPage]
  )

  const fetchNextPageWrapped = useCallback(async () => {
    const result = await fetchNextPage()
    if (result.status === 'error') {
      throw result.error ?? new Error('Failed to fetch next page')
    }
    return { hasNextPage: Boolean(result.hasNextPage) }
  }, [fetchNextPage])

  const { data: workflows } = useWorkflows(workspaceId)

  const columns = useMemo(
    () => tableData?.schema?.columns || EMPTY_COLUMNS,
    [tableData?.schema?.columns]
  )

  const tableWorkflowGroups = useMemo<WorkflowGroup[]>(
    () => tableData?.schema?.workflowGroups ?? EMPTY_GROUPS,
    [tableData?.schema?.workflowGroups]
  )

  const workflowStates = useWorkflowStates(
    useMemo(() => tableWorkflowGroups.map((g) => g.workflowId), [tableWorkflowGroups])
  )

  const columnSourceInfo = useMemo<Map<string, ColumnSourceInfo>>(() => {
    const map = new Map<string, ColumnSourceInfo>()
    for (const group of tableWorkflowGroups) {
      // Enrichment groups have no workflow blocks; their output columns render
      // with the standard column-type icon (the meta-header already carries the
      // enrichment's icon), so we skip building source info for them.
      if (group.type === 'enrichment') continue
      const state = workflowStates.get(group.workflowId)
      const blocks = (state as { blocks?: Record<string, FlattenOutputsBlockInput> } | null)?.blocks
      // `useWorkflowStates` only fetches the live draft, so we can only judge
      // "block missing" for live-mode groups. A deployed-mode group runs a
      // different graph we don't load client-side — don't risk a false badge.
      const isLiveMode = group.deploymentMode !== 'deployed'
      for (const out of group.outputs) {
        const block = blocks?.[out.blockId]
        const blockConfig = block?.type ? getBlock(block.type) : undefined
        const blockIconInfo: BlockIconInfo | undefined = blockConfig?.icon
          ? { icon: blockConfig.icon, color: blockConfig.bgColor || '#2F55FF' }
          : undefined
        const blockName = block?.name?.trim() || undefined
        // Flag a missing source block only once the workflow state has loaded
        // (truthy `blocks`), so a still-loading workflow never flashes the badge.
        const blockMissing = Boolean(isLiveMode && blocks && out.blockId && !block)
        map.set(out.columnName, { blockIconInfo, blockName, blockMissing })
      }
    }
    return map
  }, [tableWorkflowGroups, workflowStates])

  return {
    tableData,
    isLoadingTable,
    rows,
    isLoadingRows,
    refetchRows,
    fetchNextPage: fetchNextPageWrapped,
    hasNextPage: Boolean(hasNextPage),
    isFetchingNextPage,
    workflows,
    columns,
    tableWorkflowGroups,
    workflowStates,
    columnSourceInfo,
    ensureAllRowsLoaded,
    ensureRowsLoadedUpTo,
  }
}
