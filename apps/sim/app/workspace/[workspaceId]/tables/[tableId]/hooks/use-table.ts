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
      const state = workflowStates.get(group.workflowId)
      const blocks = (state as { blocks?: Record<string, FlattenOutputsBlockInput> } | null)?.blocks
      for (const out of group.outputs) {
        const block = blocks?.[out.blockId]
        const blockConfig = block?.type ? getBlock(block.type) : undefined
        const blockIconInfo: BlockIconInfo | undefined = blockConfig?.icon
          ? { icon: blockConfig.icon, color: blockConfig.bgColor || '#2F55FF' }
          : undefined
        const blockName = block?.name?.trim() || undefined
        map.set(out.columnName, { blockIconInfo, blockName })
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
  }
}
