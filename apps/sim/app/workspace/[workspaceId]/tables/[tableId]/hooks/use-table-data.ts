import { useCallback, useMemo } from 'react'
import type { TableDefinition, TableRow } from '@/lib/table'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { useInfiniteTableRows, useTable } from '@/hooks/queries/tables'
import type { QueryOptions } from '../types'

interface UseTableDataParams {
  workspaceId: string
  tableId: string
  queryOptions: QueryOptions
}

interface FetchNextPageResult {
  hasNextPage: boolean
}

interface UseTableDataReturn {
  tableData: TableDefinition | undefined
  isLoadingTable: boolean
  rows: TableRow[]
  isLoadingRows: boolean
  refetchRows: () => void
  /**
   * Fetch the next page of rows. The resolved value's `hasNextPage` reflects the
   * post-fetch cache state — read from this rather than the parent's
   * `hasNextPage` state, which only updates on the next React render.
   */
  fetchNextPage: () => Promise<FetchNextPageResult>
  hasNextPage: boolean
  isFetchingNextPage: boolean
}

export function useTableData({
  workspaceId,
  tableId,
  queryOptions,
}: UseTableDataParams): UseTableDataReturn {
  const { data: tableData, isLoading: isLoadingTable } = useTable(workspaceId, tableId)

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

  const fetchNextPageWrapped = useCallback(async () => {
    const result = await fetchNextPage()
    if (result.status === 'error') {
      throw result.error ?? new Error('Failed to fetch next page')
    }
    return { hasNextPage: Boolean(result.hasNextPage) }
  }, [fetchNextPage])

  return {
    tableData,
    isLoadingTable,
    rows,
    isLoadingRows,
    refetchRows,
    fetchNextPage: fetchNextPageWrapped,
    hasNextPage: Boolean(hasNextPage),
    isFetchingNextPage,
  }
}
