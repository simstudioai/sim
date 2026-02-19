/**
 * React Query hooks for managing user-defined tables.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Filter, Sort, TableDefinition, TableRow } from '@/lib/table'

export const tableKeys = {
  all: ['tables'] as const,
  lists: () => [...tableKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...tableKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...tableKeys.all, 'detail'] as const,
  detail: (tableId: string) => [...tableKeys.details(), tableId] as const,
  rowsRoot: (tableId: string) => [...tableKeys.detail(tableId), 'rows'] as const,
  rows: (tableId: string, paramsKey: string) =>
    [...tableKeys.rowsRoot(tableId), paramsKey] as const,
}

interface TableRowsParams {
  workspaceId: string
  tableId: string
  limit: number
  offset: number
  filter?: Filter | null
  sort?: Sort | null
}

interface TableRowsResponse {
  rows: TableRow[]
  totalCount: number
}

interface RowMutationContext {
  workspaceId: string
  tableId: string
}

interface UpdateTableRowParams {
  rowId: string
  data: Record<string, unknown>
}

interface TableRowsDeleteResult {
  deletedRowIds: string[]
}

function createRowsParamsKey({
  limit,
  offset,
  filter,
  sort,
}: Omit<TableRowsParams, 'workspaceId' | 'tableId'>): string {
  return JSON.stringify({
    limit,
    offset,
    filter: filter ?? null,
    sort: sort ?? null,
  })
}

async function fetchTable(workspaceId: string, tableId: string): Promise<TableDefinition> {
  const res = await fetch(`/api/table/${tableId}?workspaceId=${encodeURIComponent(workspaceId)}`)
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to fetch table')
  }

  const json: { data?: { table: TableDefinition }; table?: TableDefinition } = await res.json()
  const data = json.data || json
  return (data as { table: TableDefinition }).table
}

async function fetchTableRows({
  workspaceId,
  tableId,
  limit,
  offset,
  filter,
  sort,
}: TableRowsParams): Promise<TableRowsResponse> {
  const searchParams = new URLSearchParams({
    workspaceId,
    limit: String(limit),
    offset: String(offset),
  })

  if (filter) {
    searchParams.set('filter', JSON.stringify(filter))
  }

  if (sort) {
    searchParams.set('sort', JSON.stringify(sort))
  }

  const res = await fetch(`/api/table/${tableId}/rows?${searchParams}`)
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to fetch rows')
  }

  const json: {
    data?: { rows: TableRow[]; totalCount: number }
    rows?: TableRow[]
    totalCount?: number
  } = await res.json()

  const data = json.data || json
  return {
    rows: (data.rows || []) as TableRow[],
    totalCount: data.totalCount || 0,
  }
}

function invalidateTableData(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  tableId: string
) {
  queryClient.invalidateQueries({ queryKey: tableKeys.list(workspaceId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
}

/**
 * Fetch all tables for a workspace.
 */
export function useTablesList(workspaceId?: string) {
  return useQuery({
    queryKey: tableKeys.list(workspaceId),
    queryFn: async () => {
      if (!workspaceId) throw new Error('Workspace ID required')

      const res = await fetch(`/api/table?workspaceId=${encodeURIComponent(workspaceId)}`)

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to fetch tables')
      }

      const response = await res.json()
      return (response.data?.tables || []) as TableDefinition[]
    },
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
  })
}

/**
 * Fetch a single table by id.
 */
export function useTable(workspaceId: string | undefined, tableId: string | undefined) {
  return useQuery({
    queryKey: tableKeys.detail(tableId ?? ''),
    queryFn: () => fetchTable(workspaceId as string, tableId as string),
    enabled: Boolean(workspaceId && tableId),
    staleTime: 30 * 1000,
  })
}

/**
 * Fetch rows for a table with pagination/filter/sort.
 */
export function useTableRows({
  workspaceId,
  tableId,
  limit,
  offset,
  filter,
  sort,
  enabled = true,
}: TableRowsParams & { enabled?: boolean }) {
  const paramsKey = createRowsParamsKey({ limit, offset, filter, sort })

  return useQuery({
    queryKey: tableKeys.rows(tableId, paramsKey),
    queryFn: () =>
      fetchTableRows({
        workspaceId,
        tableId,
        limit,
        offset,
        filter,
        sort,
      }),
    enabled: Boolean(workspaceId && tableId) && enabled,
    placeholderData: keepPreviousData,
  })
}

/**
 * Create a new table in a workspace.
 */
export function useCreateTable(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      name: string
      description?: string
      schema: { columns: Array<{ name: string; type: string; required?: boolean }> }
    }) => {
      const res = await fetch('/api/table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, workspaceId }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to create table')
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.list(workspaceId) })
    },
  })
}

/**
 * Delete a table from a workspace.
 */
export function useDeleteTable(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (tableId: string) => {
      const res = await fetch(
        `/api/table/${tableId}?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: 'DELETE',
        }
      )

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to delete table')
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.list(workspaceId) })
    },
  })
}

/**
 * Create a row in a table.
 */
export function useCreateTableRow({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/table/${tableId}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, data }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to add row')
      }

      return res.json()
    },
    onSuccess: () => {
      invalidateTableData(queryClient, workspaceId, tableId)
    },
  })
}

/**
 * Update a single row in a table.
 */
export function useUpdateTableRow({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ rowId, data }: UpdateTableRowParams) => {
      const res = await fetch(`/api/table/${tableId}/rows/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, data }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to update row')
      }

      return res.json()
    },
    onSuccess: () => {
      invalidateTableData(queryClient, workspaceId, tableId)
    },
  })
}

/**
 * Delete a single row from a table.
 */
export function useDeleteTableRow({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (rowId: string) => {
      const res = await fetch(`/api/table/${tableId}/rows/${rowId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to delete row')
      }

      return res.json()
    },
    onSuccess: () => {
      invalidateTableData(queryClient, workspaceId, tableId)
    },
  })
}

/**
 * Delete multiple rows from a table.
 * Returns both deleted ids and failure details for partial-failure UI.
 */
export function useDeleteTableRows({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (rowIds: string[]): Promise<TableRowsDeleteResult> => {
      const uniqueRowIds = Array.from(new Set(rowIds))

      const res = await fetch(`/api/table/${tableId}/rows`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, rowIds: uniqueRowIds }),
      })

      const json: {
        error?: string
        data?: { deletedRowIds?: string[]; missingRowIds?: string[]; requestedCount?: number }
      } = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json.error || 'Failed to delete rows')
      }

      const deletedRowIds = json.data?.deletedRowIds || []
      const missingRowIds = json.data?.missingRowIds || []

      if (missingRowIds.length > 0) {
        const failureCount = missingRowIds.length
        const totalCount = json.data?.requestedCount ?? uniqueRowIds.length
        const successCount = deletedRowIds.length
        const firstMissing = missingRowIds[0]
        throw new Error(
          `Failed to delete ${failureCount} of ${totalCount} row(s)${successCount > 0 ? ` (${successCount} deleted successfully)` : ''}. Row not found: ${firstMissing}`
        )
      }

      return { deletedRowIds }
    },
    onSettled: () => {
      invalidateTableData(queryClient, workspaceId, tableId)
    },
  })
}
