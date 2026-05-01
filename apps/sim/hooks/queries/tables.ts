/**
 * React Query hooks for managing user-defined tables.
 */

import { createLogger } from '@sim/logger'
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import type {
  CsvHeaderMapping,
  Filter,
  RowData,
  Sort,
  TableDefinition,
  TableMetadata,
  TableRow,
} from '@/lib/table'

const logger = createLogger('TableQueries')

type TableQueryScope = 'active' | 'archived' | 'all'

export const tableKeys = {
  all: ['tables'] as const,
  lists: () => [...tableKeys.all, 'list'] as const,
  list: (workspaceId?: string, scope: TableQueryScope = 'active') =>
    [...tableKeys.lists(), workspaceId ?? '', scope] as const,
  details: () => [...tableKeys.all, 'detail'] as const,
  detail: (tableId: string) => [...tableKeys.details(), tableId] as const,
  rowsRoot: (tableId: string) => [...tableKeys.detail(tableId), 'rows'] as const,
  infiniteRows: (tableId: string, paramsKey: string) =>
    [...tableKeys.rowsRoot(tableId), 'infinite', paramsKey] as const,
}

interface TableRowsParams {
  workspaceId: string
  tableId: string
  limit: number
  offset: number
  filter?: Filter | null
  sort?: Sort | null
  /** When `false`, skip the server-side `COUNT(*)` and receive `totalCount: null`. */
  includeTotal?: boolean
}

interface TableRowsResponse {
  rows: TableRow[]
  /** `null` when the request opted out of the count via `includeTotal: false`. */
  totalCount: number | null
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

async function fetchTable(
  workspaceId: string,
  tableId: string,
  signal?: AbortSignal
): Promise<TableDefinition> {
  const res = await fetch(`/api/table/${tableId}?workspaceId=${encodeURIComponent(workspaceId)}`, {
    signal,
  })
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
  includeTotal,
  signal,
}: TableRowsParams & { signal?: AbortSignal }): Promise<TableRowsResponse> {
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

  if (includeTotal === false) {
    searchParams.set('includeTotal', 'false')
  }

  const res = await fetch(`/api/table/${tableId}/rows?${searchParams}`, { signal })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to fetch rows')
  }

  const json: {
    data?: { rows: TableRow[]; totalCount: number | null }
    rows?: TableRow[]
    totalCount?: number | null
  } = await res.json()

  const data = json.data || json
  return {
    rows: (data.rows || []) as TableRow[],
    totalCount: data.totalCount ?? null,
  }
}

function invalidateRowData(queryClient: ReturnType<typeof useQueryClient>, tableId: string) {
  queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
}

function invalidateRowCount(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  tableId: string
) {
  queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
}

function invalidateTableSchema(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  tableId: string
) {
  queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
}

/**
 * Fetch all tables for a workspace.
 */
export function useTablesList(workspaceId?: string, scope: TableQueryScope = 'active') {
  return useQuery({
    queryKey: tableKeys.list(workspaceId, scope),
    queryFn: async ({ signal }) => {
      if (!workspaceId) throw new Error('Workspace ID required')

      const res = await fetch(
        `/api/table?workspaceId=${encodeURIComponent(workspaceId)}&scope=${scope}`,
        {
          signal,
        }
      )

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to fetch tables')
      }

      const response = await res.json()
      return (response.data?.tables || []) as TableDefinition[]
    },
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch a single table by id.
 */
export function useTable(workspaceId: string | undefined, tableId: string | undefined) {
  return useQuery({
    queryKey: tableKeys.detail(tableId ?? ''),
    queryFn: ({ signal }) => fetchTable(workspaceId as string, tableId as string, signal),
    enabled: Boolean(workspaceId && tableId),
    staleTime: 30 * 1000,
  })
}

interface InfiniteTableRowsParams {
  workspaceId: string
  tableId: string
  pageSize: number
  filter?: Filter | null
  sort?: Sort | null
  enabled?: boolean
}

/**
 * Paginated row fetching with `useInfiniteQuery`. Each page requests `pageSize`
 * rows at the next offset; `getNextPageParam` returns `undefined` once the last
 * page comes back short, signalling end-of-list.
 *
 * Page 0 includes a server `COUNT(*)`; subsequent pages skip it.
 */
export function useInfiniteTableRows({
  workspaceId,
  tableId,
  pageSize,
  filter,
  sort,
  enabled = true,
}: InfiniteTableRowsParams) {
  const paramsKey = JSON.stringify({
    pageSize,
    filter: filter ?? null,
    sort: sort ?? null,
  })

  return useInfiniteQuery({
    queryKey: tableKeys.infiniteRows(tableId, paramsKey),
    queryFn: ({ pageParam, signal }) =>
      fetchTableRows({
        workspaceId,
        tableId,
        limit: pageSize,
        offset: pageParam,
        filter,
        sort,
        includeTotal: pageParam === 0,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.rows.length < pageSize) return undefined
      return lastPageParam + pageSize
    },
    enabled: Boolean(workspaceId && tableId) && enabled,
    staleTime: 30 * 1000,
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
      initialRowCount?: number
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
    },
  })
}

/**
 * Add a column to an existing table.
 */
export function useAddTableColumn({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (column: {
      name: string
      type: string
      required?: boolean
      unique?: boolean
      position?: number
    }) => {
      const res = await fetch(`/api/table/${tableId}/columns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, column }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to add column')
      }

      return res.json()
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, workspaceId, tableId)
    },
  })
}

/**
 * Rename a table.
 */
export function useRenameTable(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ tableId, name }: { tableId: string; name: string }) => {
      const res = await fetch(`/api/table/${tableId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, name }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to rename table')
      }

      return res.json()
    },
    onError: (error) => {
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: tableKeys.detail(variables.tableId) })
      queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
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
    onSettled: (_data, _error, tableId) => {
      queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
      queryClient.removeQueries({ queryKey: tableKeys.detail(tableId) })
      queryClient.removeQueries({ queryKey: tableKeys.rowsRoot(tableId) })
    },
  })
}

/**
 * Create a row in a table.
 * Populates the cache on success so the new row is immediately available
 * without waiting for the background refetch triggered by invalidation.
 */
export function useCreateTableRow({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: { data: Record<string, unknown>; position?: number }) => {
      const res = await fetch(`/api/table/${tableId}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, data: variables.data, position: variables.position }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to add row')
      }

      return res.json()
    },
    onSuccess: (response) => {
      const row = (response as { data?: { row?: TableRow } })?.data?.row as TableRow | undefined
      if (!row) return

      reconcileCreatedRow(queryClient, tableId, row)
    },
    onSettled: () => {
      invalidateRowCount(queryClient, workspaceId, tableId)
    },
  })
}

/**
 * Apply a row-level transformation to all cached infinite row queries for this
 * table. Used for cell edits where positions don't change.
 */
function patchCachedRows(
  queryClient: ReturnType<typeof useQueryClient>,
  tableId: string,
  patchRow: (row: TableRow) => TableRow
) {
  queryClient.setQueriesData<InfiniteData<TableRowsResponse, number>>(
    { queryKey: tableKeys.rowsRoot(tableId), exact: false },
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page) => ({ ...page, rows: page.rows.map(patchRow) })),
      }
    }
  )
}

/**
 * Splice a server-returned new row into the paginated row cache. Bumps the
 * `position` of any cached row at or past the new row's position, then inserts
 * the row into the overlapping page (or appends to the last page when the
 * position lies past everything fetched). `onSettled` invalidation reconciles
 * drift after the next refetch.
 */
function reconcileCreatedRow(
  queryClient: ReturnType<typeof useQueryClient>,
  tableId: string,
  row: TableRow
) {
  queryClient.setQueriesData<InfiniteData<TableRowsResponse, number>>(
    { queryKey: tableKeys.rowsRoot(tableId), exact: false },
    (old) => {
      if (!old) return old
      if (old.pages.some((p) => p.rows.some((r) => r.id === row.id))) return old

      const pages = old.pages.map((page) =>
        page.rows.some((r) => r.position >= row.position)
          ? {
              ...page,
              rows: page.rows.map((r) =>
                r.position >= row.position ? { ...r, position: r.position + 1 } : r
              ),
            }
          : page
      )

      let inserted = false
      const nextPages = pages.map((page) => {
        if (inserted) return page
        const last = page.rows[page.rows.length - 1]
        const fits = last === undefined || last.position >= row.position
        if (!fits) return page
        inserted = true
        const merged = [...page.rows, row].sort((a, b) => a.position - b.position)
        return { ...page, rows: merged }
      })

      if (!inserted && nextPages.length > 0) {
        const lastIdx = nextPages.length - 1
        const lastPage = nextPages[lastIdx]
        nextPages[lastIdx] = {
          ...lastPage,
          rows: [...lastPage.rows, row].sort((a, b) => a.position - b.position),
        }
      }

      const firstPage = nextPages[0]
      if (firstPage && firstPage.totalCount !== null && firstPage.totalCount !== undefined) {
        nextPages[0] = { ...firstPage, totalCount: firstPage.totalCount + 1 }
      }

      return { ...old, pages: nextPages }
    }
  )
}

interface BatchCreateTableRowsParams {
  rows: Array<Record<string, unknown>>
  positions?: number[]
}

interface BatchCreateTableRowsResponse {
  success: boolean
  data?: {
    rows: TableRow[]
    insertedCount: number
    message: string
  }
}

/**
 * Batch create rows in a table. Supports optional per-row positions for undo restore.
 */
export function useBatchCreateTableRows({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      variables: BatchCreateTableRowsParams
    ): Promise<BatchCreateTableRowsResponse> => {
      const res = await fetch(`/api/table/${tableId}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          rows: variables.rows,
          positions: variables.positions,
        }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to create rows')
      }

      return res.json()
    },
    onSettled: () => {
      invalidateRowCount(queryClient, workspaceId, tableId)
    },
  })
}

/**
 * Update a single row in a table.
 * Uses optimistic updates for instant UI feedback on inline cell edits.
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
    onMutate: ({ rowId, data }) => {
      void queryClient.cancelQueries({ queryKey: tableKeys.rowsRoot(tableId) })

      const previousQueries = queryClient.getQueriesData<InfiniteData<TableRowsResponse, number>>({
        queryKey: tableKeys.rowsRoot(tableId),
      })

      patchCachedRows(queryClient, tableId, (row) =>
        row.id === rowId ? { ...row, data: { ...row.data, ...data } as RowData } : row
      )

      return { previousQueries }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data)
        }
      }
    },
    onSettled: () => {
      invalidateRowData(queryClient, tableId)
    },
  })
}

interface BatchUpdateTableRowsParams {
  updates: Array<{ rowId: string; data: Record<string, unknown> }>
}

/**
 * Batch update multiple rows by ID. Uses optimistic updates for instant UI feedback.
 */
export function useBatchUpdateTableRows({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ updates }: BatchUpdateTableRowsParams) => {
      const res = await fetch(`/api/table/${tableId}/rows`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, updates }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to update rows')
      }

      return res.json()
    },
    onMutate: ({ updates }) => {
      void queryClient.cancelQueries({ queryKey: tableKeys.rowsRoot(tableId) })

      const previousQueries = queryClient.getQueriesData<InfiniteData<TableRowsResponse, number>>({
        queryKey: tableKeys.rowsRoot(tableId),
      })

      const updateMap = new Map(updates.map((u) => [u.rowId, u.data]))

      patchCachedRows(queryClient, tableId, (row) => {
        const patch = updateMap.get(row.id)
        if (!patch) return row
        return { ...row, data: { ...row.data, ...patch } as RowData }
      })

      return { previousQueries }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data)
        }
      }
    },
    onSettled: () => {
      invalidateRowData(queryClient, tableId)
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
    onSettled: () => {
      invalidateRowCount(queryClient, workspaceId, tableId)
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
      invalidateRowCount(queryClient, workspaceId, tableId)
    },
  })
}

interface UpdateColumnParams {
  columnName: string
  updates: {
    name?: string
    type?: string
    required?: boolean
    unique?: boolean
  }
}

/**
 * Update a column (rename, type change, or constraint update).
 */
export function useUpdateColumn({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ columnName, updates }: UpdateColumnParams) => {
      const res = await fetch(`/api/table/${tableId}/columns`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, columnName, updates }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to update column')
      }

      return res.json()
    },
    onError: (error) => {
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, workspaceId, tableId)
    },
  })
}

/**
 * Update a table's UI metadata (e.g. column widths).
 * Uses optimistic update for instant visual feedback.
 */
export function useUpdateTableMetadata({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (metadata: TableMetadata) => {
      const res = await fetch(`/api/table/${tableId}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, metadata }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error((error as { error?: string }).error || 'Failed to update metadata')
      }

      return res.json()
    },
    onMutate: async (metadata) => {
      await queryClient.cancelQueries({ queryKey: tableKeys.detail(tableId) })

      const previous = queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))

      if (previous) {
        queryClient.setQueryData<TableDefinition>(tableKeys.detail(tableId), {
          ...previous,
          metadata: { ...(previous.metadata ?? {}), ...metadata },
        })
      }

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tableKeys.detail(tableId), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId) })
    },
  })
}

/**
 * Restore an archived table.
 */
export function useRestoreTable() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (tableId: string) => {
      const res = await fetch(`/api/table/${tableId}/restore`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to restore table')
      }
      return res.json()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
    },
  })
}

interface UploadCsvParams {
  workspaceId: string
  file: File
}

/**
 * Upload a CSV file to create a new table with inferred schema.
 */
export function useUploadCsvToTable() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, file }: UploadCsvParams) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('workspaceId', workspaceId)

      const response = await fetch('/api/table/import-csv', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'CSV import failed')
      }

      return response.json()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
    },
    onError: (error) => {
      logger.error('Failed to upload CSV:', error)
    },
  })
}

export type CsvImportMode = 'append' | 'replace'

interface ImportCsvIntoTableParams {
  workspaceId: string
  tableId: string
  file: File
  mode: CsvImportMode
  mapping?: CsvHeaderMapping
  /** CSV headers to auto-create as new columns on the target table. */
  createColumns?: string[]
}

interface ImportCsvIntoTableResponse {
  success: boolean
  data?: {
    tableId: string
    mode: CsvImportMode
    insertedCount?: number
    deletedCount?: number
    mappedColumns?: string[]
    skippedHeaders?: string[]
    unmappedColumns?: string[]
    sourceFile?: string
  }
}

/**
 * Upload a CSV file to an existing table in append or replace mode. Supports
 * an optional explicit header-to-column mapping; when omitted the server
 * auto-maps headers by sanitized name.
 */
export function useImportCsvIntoTable() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      tableId,
      file,
      mode,
      mapping,
      createColumns,
    }: ImportCsvIntoTableParams): Promise<ImportCsvIntoTableResponse> => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('workspaceId', workspaceId)
      formData.append('mode', mode)
      if (mapping) {
        formData.append('mapping', JSON.stringify(mapping))
      }
      if (createColumns && createColumns.length > 0) {
        formData.append('createColumns', JSON.stringify(createColumns))
      }

      const response = await fetch(`/api/table/${tableId}/import`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'CSV import failed')
      }

      return response.json()
    },
    onSettled: (_data, _error, variables) => {
      if (!variables) return
      invalidateRowCount(queryClient, variables.workspaceId, variables.tableId)
    },
    onError: (error) => {
      logger.error('Failed to import CSV into table:', error)
    },
  })
}

/**
 * Downloads the full contents of a table to the user's device by streaming
 * `/api/table/[tableId]/export`. Defaults to CSV; pass `'json'` for JSON.
 */
export async function downloadTableExport(
  tableId: string,
  fileName: string,
  format: 'csv' | 'json' = 'csv'
): Promise<void> {
  const url = `/api/table/${tableId}/export?format=${format}&t=${Date.now()}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to export table: ${response.statusText}`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const safeName = fileName.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'table'
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = `${safeName}.${format}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}

export function useDeleteColumn({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (columnName: string) => {
      const res = await fetch(`/api/table/${tableId}/columns`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, columnName }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to delete column')
      }

      return res.json()
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, workspaceId, tableId)
    },
  })
}
