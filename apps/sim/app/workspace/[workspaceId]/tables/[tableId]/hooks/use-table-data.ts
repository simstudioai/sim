import type { TableDefinition, TableRow } from '@/lib/table'
import { useTable, useTableRows } from '@/hooks/queries/tables'
import { ROWS_PER_PAGE } from '../lib/constants'
import type { QueryOptions } from '../lib/types'

interface UseTableDataParams {
  workspaceId: string
  tableId: string
  queryOptions: QueryOptions
  currentPage: number
}

interface UseTableDataReturn {
  tableData: TableDefinition | undefined
  isLoadingTable: boolean
  rows: TableRow[]
  totalCount: number
  totalPages: number
  isLoadingRows: boolean
  refetchRows: () => void
}

export function useTableData({
  workspaceId,
  tableId,
  queryOptions,
  currentPage,
}: UseTableDataParams): UseTableDataReturn {
  const { data: tableData, isLoading: isLoadingTable } = useTable(workspaceId, tableId)

  const {
    data: rowsData,
    isLoading: isLoadingRows,
    refetch: refetchRows,
  } = useTableRows({
    workspaceId,
    tableId,
    limit: ROWS_PER_PAGE,
    offset: currentPage * ROWS_PER_PAGE,
    filter: queryOptions.filter,
    sort: queryOptions.sort,
    enabled: Boolean(workspaceId && tableId),
  })

  const rows = (rowsData?.rows || []) as TableRow[]
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
