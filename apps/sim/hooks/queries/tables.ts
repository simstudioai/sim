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
import { requestJson } from '@/lib/api/client/request'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import {
  addTableColumnContract,
  type BatchInsertTableRowsBodyInput,
  type BatchUpdateTableRowsBodyInput,
  batchCreateTableRowsContract,
  batchUpdateTableRowsContract,
  type CreateTableBodyInput,
  type CreateTableColumnBodyInput,
  createTableContract,
  createTableRowContract,
  deleteTableColumnContract,
  deleteTableContract,
  deleteTableRowContract,
  deleteTableRowsContract,
  getTableContract,
  type InsertTableRowBodyInput,
  listTableRowsContract,
  listTablesContract,
  renameTableContract,
  restoreTableContract,
  type TableIdParamsInput,
  type TableRowParamsInput,
  type TableRowsQueryInput,
  type UpdateTableColumnBodyInput,
  type UpdateTableRowBodyInput,
  updateTableColumnContract,
  updateTableMetadataContract,
  updateTableRowContract,
} from '@/lib/api/contracts/tables'
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

type TableRowsParams = Omit<TableRowsQueryInput, 'filter' | 'sort'> &
  TableIdParamsInput & {
    filter?: Filter | null
    sort?: Sort | null
  }

type TableRowsResponse = Pick<
  ContractJsonResponse<typeof listTableRowsContract>['data'],
  'rows' | 'totalCount'
>

interface RowMutationContext {
  workspaceId: string
  tableId: string
}

type UpdateTableRowParams = Pick<TableRowParamsInput, 'rowId'> &
  Omit<UpdateTableRowBodyInput, 'workspaceId' | 'data'> & {
    data: Record<string, unknown>
  }

type TableRowsDeleteResult = Pick<
  ContractJsonResponse<typeof deleteTableRowsContract>['data'],
  'deletedRowIds'
>

async function fetchTable(
  workspaceId: string,
  tableId: string,
  signal?: AbortSignal
): Promise<TableDefinition> {
  const response = await requestJson(getTableContract, {
    params: { tableId },
    query: { workspaceId },
    signal,
  })
  return response.data.table
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
  const response = await requestJson(listTableRowsContract, {
    params: { tableId },
    query: {
      workspaceId,
      limit,
      offset,
      filter: filter ?? undefined,
      sort: sort ?? undefined,
      includeTotal,
    },
    signal,
  })
  const { rows, totalCount } = response.data
  return { rows, totalCount }
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

      const response = await requestJson(listTablesContract, {
        query: { workspaceId, scope },
        signal,
      })
      return response.data.tables
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
    mutationFn: async (params: Omit<CreateTableBodyInput, 'workspaceId'>) => {
      return requestJson(createTableContract, {
        body: { ...params, workspaceId },
      })
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
    mutationFn: async (column: CreateTableColumnBodyInput['column']) => {
      return requestJson(addTableColumnContract, {
        params: { tableId },
        body: { workspaceId, column },
      })
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
      return requestJson(renameTableContract, {
        params: { tableId },
        body: { workspaceId, name },
      })
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
      return requestJson(deleteTableContract, {
        params: { tableId },
        query: { workspaceId },
      })
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
    mutationFn: async (
      variables: Omit<InsertTableRowBodyInput, 'workspaceId' | 'data'> & {
        data: Record<string, unknown>
      }
    ) => {
      return requestJson(createTableRowContract, {
        params: { tableId },
        body: { workspaceId, data: variables.data as RowData, position: variables.position },
      })
    },
    onSuccess: (response) => {
      const row = response.data.row
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

type BatchCreateTableRowsParams = Omit<BatchInsertTableRowsBodyInput, 'workspaceId' | 'rows'> & {
  rows: Array<Record<string, unknown>>
}

type BatchCreateTableRowsResponse = ContractJsonResponse<typeof batchCreateTableRowsContract>

/**
 * Batch create rows in a table. Supports optional per-row positions for undo restore.
 */
export function useBatchCreateTableRows({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      variables: BatchCreateTableRowsParams
    ): Promise<BatchCreateTableRowsResponse> => {
      return requestJson(batchCreateTableRowsContract, {
        params: { tableId },
        body: {
          workspaceId,
          rows: variables.rows as RowData[],
          positions: variables.positions,
        },
      })
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
      return requestJson(updateTableRowContract, {
        params: { tableId, rowId },
        body: { workspaceId, data: data as RowData },
      })
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

type BatchUpdateTableRowsParams = Omit<BatchUpdateTableRowsBodyInput, 'workspaceId' | 'updates'> & {
  updates: Array<{ rowId: string; data: Record<string, unknown> }>
}

/**
 * Batch update multiple rows by ID. Uses optimistic updates for instant UI feedback.
 */
export function useBatchUpdateTableRows({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ updates }: BatchUpdateTableRowsParams) => {
      return requestJson(batchUpdateTableRowsContract, {
        params: { tableId },
        body: {
          workspaceId,
          updates: updates.map((update) => ({ ...update, data: update.data as RowData })),
        },
      })
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
      return requestJson(deleteTableRowContract, {
        params: { tableId, rowId },
        body: { workspaceId },
      })
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

      const response = await requestJson(deleteTableRowsContract, {
        params: { tableId },
        body: { workspaceId, rowIds: uniqueRowIds },
      })

      const deletedRowIds = response.data.deletedRowIds || []
      const missingRowIds = response.data.missingRowIds || []

      if (missingRowIds.length > 0) {
        const failureCount = missingRowIds.length
        const totalCount = response.data.requestedCount ?? uniqueRowIds.length
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

type UpdateColumnParams = Omit<UpdateTableColumnBodyInput, 'workspaceId'>

/**
 * Update a column (rename, type change, or constraint update).
 */
export function useUpdateColumn({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ columnName, updates }: UpdateColumnParams) => {
      return requestJson(updateTableColumnContract, {
        params: { tableId },
        body: { workspaceId, columnName, updates },
      })
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
      return requestJson(updateTableMetadataContract, {
        params: { tableId },
        body: { workspaceId, metadata },
      })
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
      return requestJson(restoreTableContract, {
        params: { tableId },
      })
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

      // boundary-raw-fetch: multipart/form-data CSV upload, requestJson only supports JSON bodies
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

      // boundary-raw-fetch: multipart/form-data CSV upload, requestJson only supports JSON bodies
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
  // boundary-raw-fetch: streaming download to a Blob, requestJson cannot consume non-JSON streams
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
      return requestJson(deleteTableColumnContract, {
        params: { tableId },
        body: { workspaceId, columnName },
      })
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, workspaceId, tableId)
    },
  })
}
