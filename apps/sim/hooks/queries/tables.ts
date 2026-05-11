'use client'

/**
 * React Query hooks for managing user-defined tables.
 */

import { createLogger } from '@sim/logger'
import {
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { isValidationError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import {
  type AddWorkflowGroupBodyInput,
  addTableColumnContract,
  addWorkflowGroupContract,
  type BatchInsertTableRowsBodyInput,
  type BatchUpdateTableRowsBodyInput,
  batchCreateTableRowsContract,
  batchUpdateTableRowsContract,
  type CreateTableBodyInput,
  type CreateTableColumnBodyInput,
  cancelTableRunsContract,
  createTableContract,
  createTableRowContract,
  deleteTableColumnContract,
  deleteTableContract,
  deleteTableRowContract,
  deleteTableRowsContract,
  deleteWorkflowGroupContract,
  getTableContract,
  type InsertTableRowBodyInput,
  listTableRowsContract,
  listTablesContract,
  type RunMode,
  renameTableContract,
  restoreTableContract,
  runColumnContract,
  type TableIdParamsInput,
  type TableRowParamsInput,
  type TableRowsQueryInput,
  type UpdateTableColumnBodyInput,
  type UpdateTableRowBodyInput,
  type UpdateWorkflowGroupBodyInput,
  updateTableColumnContract,
  updateTableMetadataContract,
  updateTableRowContract,
  updateWorkflowGroupContract,
} from '@/lib/api/contracts/tables'
import type {
  CsvHeaderMapping,
  Filter,
  RowData,
  RowExecutionMetadata,
  RowExecutions,
  Sort,
  TableDefinition,
  TableMetadata,
  TableRow,
  WorkflowGroup,
  WorkflowGroupDependencies,
  WorkflowGroupOutput,
} from '@/lib/table'
import { areOutputsFilled, optimisticallyScheduleNewlyEligibleGroups } from '@/lib/table/deps'

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

export type TableRowsResponse = Pick<
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

function invalidateRowCount(queryClient: ReturnType<typeof useQueryClient>, tableId: string) {
  queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
}

function invalidateTableSchema(queryClient: ReturnType<typeof useQueryClient>, tableId: string) {
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

export function useTableRows({
  workspaceId,
  tableId,
  limit,
  offset,
  filter,
  sort,
  includeTotal,
  enabled = true,
}: TableRowsParams & { enabled?: boolean }) {
  const paramsKey = JSON.stringify({
    limit,
    offset,
    filter: filter ?? null,
    sort: sort ?? null,
    includeTotal,
  })

  return useQuery({
    queryKey: [...tableKeys.rowsRoot(tableId), paramsKey] as const,
    queryFn: ({ signal }) =>
      fetchTableRows({ workspaceId, tableId, limit, offset, filter, sort, includeTotal, signal }),
    enabled: Boolean(workspaceId && tableId) && enabled,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function tableRowsParamsKey({
  pageSize,
  filter,
  sort,
}: Pick<InfiniteTableRowsParams, 'pageSize' | 'filter' | 'sort'>): string {
  return JSON.stringify({ pageSize, filter: filter ?? null, sort: sort ?? null })
}

export function tableRowsInfiniteOptions({
  workspaceId,
  tableId,
  pageSize,
  filter,
  sort,
}: Omit<InfiniteTableRowsParams, 'enabled'>) {
  const paramsKey = tableRowsParamsKey({ pageSize, filter, sort })
  return infiniteQueryOptions({
    queryKey: tableKeys.infiniteRows(tableId, paramsKey),
    queryFn: ({ pageParam, signal }) =>
      fetchTableRows({
        workspaceId,
        tableId,
        limit: pageSize,
        offset: pageParam as number,
        filter,
        sort,
        includeTotal: pageParam === 0,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.rows.length < pageSize) return undefined
      return (lastPageParam as number) + pageSize
    },
    staleTime: 30 * 1000,
  })
}

/** Page 0 fetches a server-side `COUNT(*)`; subsequent pages skip it. */
export function useInfiniteTableRows({
  workspaceId,
  tableId,
  pageSize,
  filter,
  sort,
  enabled = true,
}: InfiniteTableRowsParams) {
  return useInfiniteQuery({
    ...tableRowsInfiniteOptions({ workspaceId, tableId, pageSize, filter, sort }),
    enabled: Boolean(workspaceId && tableId) && enabled,
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
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
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
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, tableId)
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
      if (isValidationError(error)) return
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
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
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
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateRowCount(queryClient, tableId)
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
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateRowCount(queryClient, tableId)
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

      const groups =
        queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))?.schema
          .workflowGroups ?? []

      patchCachedRows(queryClient, tableId, (row) => {
        if (row.id !== rowId) return row
        const patch = data as Partial<RowData>
        const nextExecutions = optimisticallyScheduleNewlyEligibleGroups(groups, row, patch)
        return {
          ...row,
          data: { ...row.data, ...patch } as RowData,
          ...(nextExecutions ? { executions: nextExecutions } : {}),
        }
      })

      return { previousQueries }
    },
    onError: (error, _vars, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data)
        }
      }
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
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
      const groups =
        queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))?.schema
          .workflowGroups ?? []

      patchCachedRows(queryClient, tableId, (row) => {
        const raw = updateMap.get(row.id)
        if (!raw) return row
        const patch = raw as Partial<RowData>
        const nextExecutions = optimisticallyScheduleNewlyEligibleGroups(groups, row, patch)
        return {
          ...row,
          data: { ...row.data, ...patch } as RowData,
          ...(nextExecutions ? { executions: nextExecutions } : {}),
        }
      })

      return { previousQueries }
    },
    onError: (error, _vars, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data)
        }
      }
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
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
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateRowCount(queryClient, tableId)
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
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateRowCount(queryClient, tableId)
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
    onMutate: async ({ columnName, updates }) => {
      await queryClient.cancelQueries({ queryKey: tableKeys.detail(tableId) })
      const previousDetail = queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))
      if (previousDetail) {
        const lower = columnName.toLowerCase()
        const nextColumns = previousDetail.schema.columns.map((c) =>
          c.name.toLowerCase() === lower ? { ...c, ...updates } : c
        )
        queryClient.setQueryData<TableDefinition>(tableKeys.detail(tableId), {
          ...previousDetail,
          schema: { ...previousDetail.schema, columns: nextColumns },
        })
      }

      const newName = (updates as { name?: string }).name
      const rowSnapshots =
        typeof newName === 'string' && newName.length > 0 && newName !== columnName
          ? await snapshotAndMutateRows(queryClient, tableId, (row) => {
              const lower = columnName.toLowerCase()
              const matchKey = Object.keys(row.data).find((k) => k.toLowerCase() === lower)
              if (!matchKey) return null
              const { [matchKey]: value, ...rest } = row.data
              return { ...row, data: { ...rest, [newName]: value } }
            })
          : []

      return { previousDetail, rowSnapshots }
    },
    onError: (error, _vars, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(tableKeys.detail(tableId), context.previousDetail)
      }
      if (context?.rowSnapshots) {
        for (const [key, data] of context.rowSnapshots) {
          queryClient.setQueryData(key, data)
        }
      }
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, tableId)
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

interface CancelRunsParams {
  scope: 'all' | 'row'
  rowId?: string
}

/**
 * Cancel in-flight and queued workflow-column runs for a table.
 * Scope is either `all` (table-wide) or `row` (a single row).
 *
 * Optimistically writes `cancelled` to every running/pending workflow cell in
 * scope so the UI shows the stop immediately. The server-side write is the
 * source of truth — the invalidation in `onSettled` reconciles any drift.
 */
export function useCancelTableRuns({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ scope, rowId }: CancelRunsParams) => {
      return requestJson(cancelTableRunsContract, {
        params: { tableId },
        body: { workspaceId, scope, rowId },
      })
    },
    onMutate: async ({ scope, rowId }) => {
      const snapshots = await snapshotAndMutateRows(queryClient, tableId, (r) => {
        if (scope === 'row' && r.id !== rowId) return null
        const executions = (r.executions ?? {}) as RowExecutions
        let rowTouched = false
        const nextExecutions: RowExecutions = { ...executions }
        for (const gid in executions) {
          const exec = executions[gid]
          if (!isOptimisticInFlight(exec)) continue
          // Preserve blockErrors so cells that already errored keep their
          // Error rendering after the stop — only cells without a value or
          // error should flip to "Cancelled".
          nextExecutions[gid] = {
            status: 'cancelled',
            executionId: exec.executionId ?? null,
            jobId: null,
            workflowId: exec.workflowId,
            error: 'Cancelled',
            ...(exec.blockErrors ? { blockErrors: exec.blockErrors } : {}),
          }
          rowTouched = true
        }
        return rowTouched ? { ...r, executions: nextExecutions } : null
      })
      return { snapshots }
    },
    onError: (_err, _variables, context) => {
      if (context?.snapshots) restoreCachedWorkflowCells(queryClient, context.snapshots)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
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
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
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
    onError: (error) => {
      logger.error('Failed to upload CSV:', error)
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
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
    onError: (error) => {
      logger.error('Failed to import CSV into table:', error)
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, variables) => {
      invalidateRowCount(queryClient, variables.tableId)
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
    onMutate: async (columnName) => {
      await queryClient.cancelQueries({ queryKey: tableKeys.detail(tableId) })

      const lower = columnName.toLowerCase()
      const previousDetail = queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))
      if (previousDetail) {
        const nextColumns = previousDetail.schema.columns.filter(
          (c) => c.name.toLowerCase() !== lower
        )
        const prevWidths = previousDetail.metadata?.columnWidths
        const nextMetadata = prevWidths
          ? {
              ...previousDetail.metadata,
              columnWidths: Object.fromEntries(
                Object.entries(prevWidths).filter(([k]) => k.toLowerCase() !== lower)
              ),
            }
          : previousDetail.metadata
        queryClient.setQueryData<TableDefinition>(tableKeys.detail(tableId), {
          ...previousDetail,
          schema: { ...previousDetail.schema, columns: nextColumns },
          metadata: nextMetadata,
        })
      }

      const rowSnapshots = await snapshotAndMutateRows(queryClient, tableId, (row) => {
        const matchKey = Object.keys(row.data).find((k) => k.toLowerCase() === lower)
        if (!matchKey) return null
        const { [matchKey]: _removed, ...rest } = row.data
        return { ...row, data: rest }
      })

      return { previousDetail, rowSnapshots }
    },
    onError: (error, _columnName, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(tableKeys.detail(tableId), context.previousDetail)
      }
      if (context?.rowSnapshots) {
        for (const [key, data] of context.rowSnapshots) {
          queryClient.setQueryData(key, data)
        }
      }
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, tableId)
    },
  })
}

interface RunColumnVariables {
  groupIds: string[]
  /** `all` (default) fires every dep-satisfied row; `incomplete` skips rows
   *  whose last run completed successfully. */
  runMode?: RunMode
  /** Restrict to these rows. Server applies the same eligibility predicate. */
  rowIds?: string[]
}

type InfiniteRowsCache = { pages: TableRowsResponse[]; pageParams: number[] }
/**
 * Cache shapes that hold table-row data. Single-page (`useTableRows`) and
 * infinite (`useInfiniteTableRows`) live under the same `rowsRoot(tableId)`
 * prefix, so optimistic mutations have to walk both shapes.
 */
type RowsCacheEntry = TableRowsResponse | InfiniteRowsCache
type RowsCacheSnapshots = Array<[ReadonlyArray<unknown>, RowsCacheEntry]>

function isInfiniteRowsCache(value: unknown): value is InfiniteRowsCache {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { pages?: unknown }).pages) &&
    Array.isArray((value as { pageParams?: unknown }).pageParams)
  )
}

/**
 * Walks every cached query under `rowsRoot(tableId)` and applies `transform`
 * to each row. Handles both cache shapes — the single-page `TableRowsResponse`
 * and the infinite-query `{ pages, pageParams }`. `transform(row)` returns
 * the next row to write, or `null` to leave it.
 *
 * Returns the list of `[queryKey, prior data]` entries so optimistic-update
 * callers can roll back. SSE patchers can ignore the return value.
 *
 * `cancelInFlight` defaults to true (the optimistic-update contract) but SSE
 * patchers pass `false` so live cell updates don't kick the row query off the
 * network.
 */
/** Walks every cached query under `rowsRoot(tableId)` and applies `transform`
 *  to each row. Transform returns the new row or `null` to skip. Returns the
 *  list of [queryKey, prior data] entries so optimistic-update callers can
 *  roll back. SSE patchers can ignore the return value. */
export async function snapshotAndMutateRows(
  queryClient: ReturnType<typeof useQueryClient>,
  tableId: string,
  transform: (row: TableRow) => TableRow | null,
  options?: { cancelInFlight?: boolean }
): Promise<RowsCacheSnapshots> {
  if (options?.cancelInFlight !== false) {
    await queryClient.cancelQueries({ queryKey: tableKeys.rowsRoot(tableId) })
  }
  const matching = queryClient.getQueriesData<RowsCacheEntry>({
    queryKey: tableKeys.rowsRoot(tableId),
  })
  const snapshots: RowsCacheSnapshots = []
  for (const [key, data] of matching) {
    if (!data) continue
    if (isInfiniteRowsCache(data)) {
      let touched = false
      const nextPages = data.pages.map((page) => {
        let pageTouched = false
        const nextRows = page.rows.map((r) => {
          const next = transform(r)
          if (!next) return r
          pageTouched = true
          touched = true
          return next
        })
        return pageTouched ? { ...page, rows: nextRows } : page
      })
      if (!touched) continue
      snapshots.push([key, data])
      queryClient.setQueryData<InfiniteRowsCache>(key, { ...data, pages: nextPages })
      continue
    }
    let touched = false
    const nextRows = data.rows.map((r) => {
      const next = transform(r)
      if (!next) return r
      touched = true
      return next
    })
    if (!touched) continue
    snapshots.push([key, data])
    queryClient.setQueryData<TableRowsResponse>(key, { ...data, rows: nextRows })
  }
  return snapshots
}

export function restoreCachedWorkflowCells(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: RowsCacheSnapshots
) {
  for (const [key, data] of snapshots) {
    queryClient.setQueryData(key, data)
  }
}

/**
 * Optimistic exec patch — flips every targeted (group, row) execution to
 * `pending` so the UI doesn't lag the round-trip. Server eligibility may skip
 * some; refetch on settle reconciles.
 */
function buildPendingExec(
  prev: RowExecutionMetadata | undefined,
  workflowIdFallback?: string
): RowExecutionMetadata {
  return {
    status: 'pending',
    executionId: prev?.executionId ?? null,
    jobId: null,
    workflowId: prev?.workflowId ?? workflowIdFallback ?? '',
    error: null,
  }
}

/** Broader sibling of `isExecInFlight` from `lib/table/deps`: treats any
 *  `pending` (with or without a jobId) as in-flight. The optimistic-patch
 *  context uses this to avoid re-marking a cell we just flipped optimistically.
 *  The eligibility predicate uses the stricter version. */
function isOptimisticInFlight(exec: RowExecutionMetadata | undefined): boolean {
  return exec?.status === 'running' || exec?.status === 'queued' || exec?.status === 'pending'
}

/**
 * The single canonical run mutation. Every UI gesture (single cell, per-row
 * Play, action-bar Play/Refresh, column-header menu) maps to a `groupIds` +
 * optional `rowIds` shape. Optimistic patch flips targeted (row, group) cells
 * to `pending`; refetch on settle reconciles.
 */
export function useRunColumn({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ groupIds, runMode = 'all', rowIds }: RunColumnVariables) => {
      return requestJson(runColumnContract, {
        params: { tableId },
        body: {
          workspaceId,
          groupIds,
          runMode,
          ...(rowIds && rowIds.length > 0 ? { rowIds } : {}),
        },
      })
    },
    onMutate: async ({ groupIds, runMode = 'all', rowIds }) => {
      const targetRowIds = rowIds && rowIds.length > 0 ? new Set(rowIds) : null
      const targetGroupIds = new Set(groupIds)
      const groups =
        queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))?.schema
          .workflowGroups ?? []
      const groupsById = new Map(groups.map((g) => [g.id, g]))
      const snapshots = await snapshotAndMutateRows(queryClient, tableId, (r) => {
        if (targetRowIds && !targetRowIds.has(r.id)) return null
        const executions = r.executions ?? {}
        let changed = false
        const next: RowExecutions = { ...executions }
        for (const groupId of targetGroupIds) {
          const exec = executions[groupId] as RowExecutionMetadata | undefined
          if (isOptimisticInFlight(exec)) continue
          // Mirror server eligibility for `mode: 'incomplete'`: skip cells whose
          // outputs are filled, regardless of exec status. A cancelled/error
          // cell with a leftover value from a prior run was rendering as filled
          // but flipping to "queued" optimistically here even though the server
          // would skip it.
          if (runMode === 'incomplete') {
            const group = groupsById.get(groupId)
            if (group && areOutputsFilled(group, r)) continue
          }
          next[groupId] = buildPendingExec(exec)
          changed = true
        }
        if (!changed) return null
        return { ...r, executions: next }
      })
      return { snapshots }
    },
    onError: (_err, _variables, context) => {
      if (context?.snapshots) restoreCachedWorkflowCells(queryClient, context.snapshots)
    },
    // No reconciliation here — useTableEventStream is the source of truth for
    // post-mutation cache state, and a refetch would race its incremental
    // patches.
  })
}

interface AddWorkflowGroupVariables {
  group: WorkflowGroup
  outputColumns: AddWorkflowGroupBodyInput['outputColumns']
}

export function useAddWorkflowGroup({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ group, outputColumns }: AddWorkflowGroupVariables) => {
      return requestJson(addWorkflowGroupContract, {
        params: { tableId },
        body: { workspaceId, group, outputColumns },
      })
    },
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, tableId)
    },
  })
}

interface UpdateWorkflowGroupVariables {
  groupId: string
  workflowId?: string
  name?: string
  dependencies?: WorkflowGroupDependencies
  outputs?: WorkflowGroupOutput[]
  newOutputColumns?: UpdateWorkflowGroupBodyInput['newOutputColumns']
  mappingUpdates?: UpdateWorkflowGroupBodyInput['mappingUpdates']
  autoRun?: boolean
}

export function useUpdateWorkflowGroup({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateWorkflowGroupVariables) => {
      return requestJson(updateWorkflowGroupContract, {
        params: { tableId },
        body: { workspaceId, ...vars },
      })
    },
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, tableId)
      queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
    },
  })
}

interface DeleteWorkflowGroupVariables {
  groupId: string
}

export function useDeleteWorkflowGroup({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ groupId }: DeleteWorkflowGroupVariables) => {
      return requestJson(deleteWorkflowGroupContract, {
        params: { tableId },
        body: { workspaceId, groupId },
      })
    },
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, tableId)
      queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
    },
  })
}
