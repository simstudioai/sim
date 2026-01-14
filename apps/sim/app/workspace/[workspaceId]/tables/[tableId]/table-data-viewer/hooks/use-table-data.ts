/**
 * Hook for fetching table data and rows.
 *
 * @module tables/[tableId]/table-data-viewer/hooks/use-table-data
 */

import { useQuery } from '@tanstack/react-query'
import type { QueryOptions } from '../../components/filter-builder'
import { ROWS_PER_PAGE } from '../constants'
import type { TableData, TableRowData } from '../types'

interface UseTableDataParams {
  workspaceId: string
  tableId: string
  queryOptions: QueryOptions
  currentPage: number
}

interface UseTableDataReturn {
  tableData: TableData | undefined
  isLoadingTable: boolean
  rows: TableRowData[]
  totalCount: number
  totalPages: number
  isLoadingRows: boolean
  refetchRows: () => void
}

/**
 * Fetches table metadata and rows with filtering/sorting support.
 *
 * @param params - The parameters for fetching table data
 * @returns Table data, rows, and loading states
 */
export function useTableData({
  workspaceId,
  tableId,
  queryOptions,
  currentPage,
}: UseTableDataParams): UseTableDataReturn {
  // Fetch table metadata
  const { data: tableData, isLoading: isLoadingTable } = useQuery({
    queryKey: ['table', tableId],
    queryFn: async () => {
      const res = await fetch(`/api/table/${tableId}?workspaceId=${workspaceId}`)
      if (!res.ok) throw new Error('Failed to fetch table')
      const json: { data?: { table: TableData }; table?: TableData } = await res.json()
      const data = json.data || json
      return (data as { table: TableData }).table
    },
  })

  // Fetch table rows with filter and sort
  const {
    data: rowsData,
    isLoading: isLoadingRows,
    refetch: refetchRows,
  } = useQuery({
    queryKey: ['table-rows', tableId, queryOptions, currentPage],
    queryFn: async () => {
      const searchParams = new URLSearchParams({
        workspaceId,
        limit: String(ROWS_PER_PAGE),
        offset: String(currentPage * ROWS_PER_PAGE),
      })

      if (queryOptions.filter) {
        searchParams.set('filter', JSON.stringify(queryOptions.filter))
      }

      if (queryOptions.sort) {
        // Convert from {column, direction} to {column: direction} format expected by API
        const sortParam = { [queryOptions.sort.column]: queryOptions.sort.direction }
        searchParams.set('sort', JSON.stringify(sortParam))
      }

      const res = await fetch(`/api/table/${tableId}/rows?${searchParams}`)
      if (!res.ok) throw new Error('Failed to fetch rows')
      const json: {
        data?: { rows: TableRowData[]; totalCount: number }
        rows?: TableRowData[]
        totalCount?: number
      } = await res.json()
      return json.data || json
    },
    enabled: !!tableData,
  })

  const rows = (rowsData?.rows || []) as TableRowData[]
  const totalCount = rowsData?.totalCount || 0
  const totalPages = Math.ceil(totalCount / ROWS_PER_PAGE)

  return {
    tableData,
    isLoadingTable,
    rows,
    totalCount,
    totalPages,
    isLoadingRows,
    refetchRows,
  }
}
