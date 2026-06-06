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
  type ActiveDispatch,
  type AddWorkflowGroupBodyInput,
  addTableColumnContract,
  addWorkflowGroupContract,
  type BatchInsertTableRowsBodyInput,
  type BatchUpdateTableRowsBodyInput,
  batchCreateTableRowsContract,
  batchUpdateTableRowsContract,
  type CreateTableBodyInput,
  type CreateTableColumnBodyInput,
  cancelTableImportContract,
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
  importIntoTableAsyncContract,
  importTableAsyncContract,
  listActiveDispatchesContract,
  listTableRowsContract,
  listTablesContract,
  type RunLimit,
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
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  areGroupDepsSatisfied,
  isExecInFlight,
  optimisticallyScheduleNewlyEligibleGroups,
} from '@/lib/table/deps'
import { runUploadStrategy } from '@/lib/uploads/client/direct-upload'

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
  rowWrites: (tableId: string) => [...tableKeys.rowsRoot(tableId), 'write'] as const,
  activeDispatches: (tableId: string) =>
    [...tableKeys.detail(tableId), 'active-dispatches'] as const,
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
export function useTablesList(
  workspaceId?: string,
  scope: TableQueryScope = 'active',
  options?: {
    /** Poll cadence, or a predicate over the current list that returns a cadence (or `false`). */
    refetchInterval?: number | false | ((tables: TableDefinition[] | undefined) => number | false)
  }
) {
  const refetchInterval = options?.refetchInterval
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
    refetchInterval:
      typeof refetchInterval === 'function'
        ? (query) => refetchInterval(query.state.data)
        : (refetchInterval ?? false),
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

export interface TableRunState {
  dispatches: ActiveDispatch[]
  runningCellCount: number
  runningByRowId: Record<string, number>
}

async function fetchTableRunState(tableId: string, signal?: AbortSignal): Promise<TableRunState> {
  const response = await requestJson(listActiveDispatchesContract, {
    params: { tableId },
    signal,
  })
  return {
    dispatches: response.data.dispatches,
    runningCellCount: response.data.runningCellCount,
    runningByRowId: response.data.runningByRowId,
  }
}

/** Count groups flipped to in-flight (`pending`) by an optimistic schedule that
 *  weren't in-flight before — the delta to add to the run-state counter. */
function countNewlyInFlight(before: RowExecutions, after: RowExecutions): number {
  let n = 0
  for (const gid of Object.keys(after)) {
    if (after[gid]?.status === 'pending' && !isExecInFlight(before[gid])) n++
  }
  return n
}

/** The table's maintained, unfiltered `rowCount` from the detail cache (or
 *  `null` when the detail hasn't loaded). This is the right scope for a Run-all
 *  estimate: the dispatcher runs every row regardless of the active view
 *  filter, whereas the rows query's `totalCount` is filter-scoped. */
function readTableRowCount(
  queryClient: ReturnType<typeof useQueryClient>,
  tableId: string
): number | null {
  const def = queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))
  return typeof def?.rowCount === 'number' ? def.rowCount : null
}

/** Optimistically reflect a run on the "X running" badge + per-row gutter Stop
 *  instantly (the optimistic stamp eats the dispatcher's `pending` SSE, so
 *  `applyCell` never bumps the count, and the server's dispatch-scope count
 *  isn't live until the first window). `stampedByRow` drives the per-row gutter
 *  (loaded rows only); `cellCountDelta` is the badge delta — pass the full run
 *  scope (rows × groups) for Run-all so it matches the server, or omit to use
 *  the stamped total. Returns the prior snapshot for rollback. */
function bumpRunState(
  queryClient: ReturnType<typeof useQueryClient>,
  tableId: string,
  stampedByRow: Record<string, number>,
  cellCountDelta?: number
): { snapshot: TableRunState | undefined } | null {
  const stampedTotal = Object.values(stampedByRow).reduce((s, n) => s + n, 0)
  const countDelta = cellCountDelta ?? stampedTotal
  if (countDelta === 0 && stampedTotal === 0) return null
  const snapshot = queryClient.getQueryData<TableRunState>(tableKeys.activeDispatches(tableId))
  queryClient.setQueryData<TableRunState>(tableKeys.activeDispatches(tableId), (prev) => {
    const base = prev ?? { dispatches: [], runningCellCount: 0, runningByRowId: {} }
    const nextByRow = { ...base.runningByRowId }
    for (const [rid, n] of Object.entries(stampedByRow)) {
      nextByRow[rid] = (nextByRow[rid] ?? 0) + n
    }
    return {
      ...base,
      runningCellCount: base.runningCellCount + countDelta,
      runningByRowId: nextByRow,
    }
  })
  return { snapshot }
}

/**
 * Aggregate live state for a table: active dispatches (drives the "about to
 * run" overlay), the running-cell count (top-right counter), and per-row
 * running counts (per-row badge). Bootstrap snapshot fetched once on mount;
 * SSE `kind: 'cell'` and `kind: 'dispatch'` events incrementally update the
 * same cache.
 */
export function useTableRunState(tableId: string | undefined) {
  return useQuery({
    queryKey: tableKeys.activeDispatches(tableId ?? ''),
    queryFn: ({ signal }) => fetchTableRunState(tableId as string, signal),
    enabled: Boolean(tableId),
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
        body: {
          workspaceId,
          data: variables.data as RowData,
          position: variables.position,
          afterRowId: variables.afterRowId,
          beforeRowId: variables.beforeRowId,
        },
      })
    },
    onSuccess: (response) => {
      const row = response.data.row
      if (!row) return

      const groups =
        queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))?.schema
          .workflowGroups ?? []
      const stamped = withOptimisticAutoFireExec(groups, row)
      reconcileCreatedRow(queryClient, tableId, stamped)
      // Bump the run-state counter for any auto-fire groups stamped pending so
      // the "X running" badge + gutter Stop show immediately (the row had no
      // prior executions, so the stamped set is the full delta).
      const stampedCount = countNewlyInFlight({}, stamped.executions ?? {})
      if (stampedCount > 0) bumpRunState(queryClient, tableId, { [row.id]: stampedCount })
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
 * Pre-stamp `pending` for any auto-fire-eligible workflow groups on a row that
 * was just inserted server-side. Mirrors the server's `mode: 'new'` dispatch:
 * the server will fire these groups in the background; the optimistic stamp
 * shows the user a `queued` badge immediately rather than waiting ~1s for the
 * first SSE event.
 */
function withOptimisticAutoFireExec(groups: WorkflowGroup[], row: TableRow): TableRow {
  const nextExecutions = optimisticallyScheduleNewlyEligibleGroups(groups, row, {})
  if (!nextExecutions) return row
  return { ...row, executions: nextExecutions }
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

      // Use key-ordering only when the new row AND every cached row have an
      // `orderKey` — then no neighbor bump is needed and order is exact. If any
      // cached row is un-keyed (mid-backfill), fall back to the legacy `position`
      // path so un-keyed rows aren't yanked to the front by an empty-string sort.
      const byKey =
        row.orderKey != null && old.pages.every((p) => p.rows.every((r) => r.orderKey != null))
      const sortRows = (rows: TableRow[]) =>
        byKey
          ? [...rows].sort((a, b) => (a.orderKey as string).localeCompare(b.orderKey as string))
          : [...rows].sort((a, b) => a.position - b.position)
      const fitsAfter = (last: TableRow | undefined) =>
        last === undefined ||
        (byKey
          ? (last.orderKey as string) >= (row.orderKey as string)
          : last.position >= row.position)

      const pages = byKey
        ? old.pages
        : old.pages.map((page) =>
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
        if (!fitsAfter(page.rows[page.rows.length - 1])) return page
        inserted = true
        return { ...page, rows: sortRows([...page.rows, row]) }
      })

      if (!inserted && nextPages.length > 0) {
        const lastIdx = nextPages.length - 1
        const lastPage = nextPages[lastIdx]
        nextPages[lastIdx] = { ...lastPage, rows: sortRows([...lastPage.rows, row]) }
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
          orderKeys: variables.orderKeys,
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
    mutationKey: tableKeys.rowWrites(tableId),
    mutationFn: async ({ rowId, data }: UpdateTableRowParams) => {
      return requestJson(updateTableRowContract, {
        params: { tableId, rowId },
        body: { workspaceId, data: data as RowData },
      })
    },
    onMutate: async ({ rowId, data }) => {
      await queryClient.cancelQueries({ queryKey: tableKeys.rowsRoot(tableId) })

      const previousQueries = queryClient.getQueriesData<InfiniteData<TableRowsResponse, number>>({
        queryKey: tableKeys.rowsRoot(tableId),
      })

      const groups =
        queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))?.schema
          .workflowGroups ?? []

      const stampedByRow: Record<string, number> = {}
      patchCachedRows(queryClient, tableId, (row) => {
        if (row.id !== rowId) return row
        const patch = data as Partial<RowData>
        const nextExecutions = optimisticallyScheduleNewlyEligibleGroups(groups, row, patch)
        if (nextExecutions) {
          stampedByRow[row.id] = countNewlyInFlight(row.executions ?? {}, nextExecutions)
        }
        return {
          ...row,
          data: { ...row.data, ...patch } as RowData,
          ...(nextExecutions ? { executions: nextExecutions } : {}),
        }
      })

      const bumped = bumpRunState(queryClient, tableId, stampedByRow)
      return {
        previousQueries,
        runStateSnapshot: bumped?.snapshot,
        didBumpRunState: bumped !== null,
      }
    },
    onSuccess: (response, { rowId, data: mutatedData }) => {
      const serverRow = response.data.row
      const mutatedKeys = Object.keys(mutatedData)
      patchCachedRows(queryClient, tableId, (row) => {
        if (row.id !== rowId) return row
        const merged: RowData = { ...row.data }
        for (const key of mutatedKeys) {
          merged[key] = (serverRow.data as RowData)[key]
        }
        return {
          ...row,
          data: merged,
          position: serverRow.position,
          createdAt: serverRow.createdAt,
          updatedAt: serverRow.updatedAt,
        }
      })
    },
    onError: (error, _vars, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data)
        }
      }
      if (context?.didBumpRunState) {
        queryClient.setQueryData(tableKeys.activeDispatches(tableId), context.runStateSnapshot)
      }
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
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
    mutationKey: tableKeys.rowWrites(tableId),
    mutationFn: async ({ updates }: BatchUpdateTableRowsParams) => {
      return requestJson(batchUpdateTableRowsContract, {
        params: { tableId },
        body: {
          workspaceId,
          updates: updates.map((update) => ({ ...update, data: update.data as RowData })),
        },
      })
    },
    onMutate: async ({ updates }) => {
      await queryClient.cancelQueries({ queryKey: tableKeys.rowsRoot(tableId) })

      const previousQueries = queryClient.getQueriesData<InfiniteData<TableRowsResponse, number>>({
        queryKey: tableKeys.rowsRoot(tableId),
      })

      const updateMap = new Map(updates.map((u) => [u.rowId, u.data]))
      const groups =
        queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))?.schema
          .workflowGroups ?? []

      const stampedByRow: Record<string, number> = {}
      patchCachedRows(queryClient, tableId, (row) => {
        const raw = updateMap.get(row.id)
        if (!raw) return row
        const patch = raw as Partial<RowData>
        const nextExecutions = optimisticallyScheduleNewlyEligibleGroups(groups, row, patch)
        if (nextExecutions) {
          stampedByRow[row.id] = countNewlyInFlight(row.executions ?? {}, nextExecutions)
        }
        return {
          ...row,
          data: { ...row.data, ...patch } as RowData,
          ...(nextExecutions ? { executions: nextExecutions } : {}),
        }
      })

      const bumped = bumpRunState(queryClient, tableId, stampedByRow)
      return {
        previousQueries,
        runStateSnapshot: bumped?.snapshot,
        didBumpRunState: bumped !== null,
      }
    },
    onError: (error, _vars, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data)
        }
      }
      if (context?.didBumpRunState) {
        queryClient.setQueryData(tableKeys.activeDispatches(tableId), context.runStateSnapshot)
      }
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
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

      // The delete contract caps `rowIds` at MAX_BULK_OPERATION_SIZE, so large
      // selections (e.g. "select all") are sent as sequential chunks.
      const chunkSize = TABLE_LIMITS.MAX_BULK_OPERATION_SIZE
      const deletedRowIds: string[] = []
      const missingRowIds: string[] = []
      for (let i = 0; i < uniqueRowIds.length; i += chunkSize) {
        const chunk = uniqueRowIds.slice(i, i + chunkSize)
        const response = await requestJson(deleteTableRowsContract, {
          params: { tableId },
          body: { workspaceId, rowIds: chunk },
        })
        deletedRowIds.push(...(response.data.deletedRowIds || []))
        missingRowIds.push(...(response.data.missingRowIds || []))
      }

      if (missingRowIds.length > 0) {
        const failureCount = missingRowIds.length
        const totalCount = uniqueRowIds.length
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
          if (!isExecInFlight(exec)) continue
          if (exec.executionId == null) {
            // Optimistic-only or dispatcher-pre-stamp pending — server has not
            // claimed the cell yet, so no SSE will arrive to reconcile a
            // `cancelled` stamp. Strip the entry instead and let the renderer
            // fall through to the cell's prior state (value / empty / etc.).
            delete nextExecutions[gid]
            rowTouched = true
            continue
          }
          nextExecutions[gid] = {
            status: 'cancelled',
            executionId: exec.executionId,
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
      // Refetch the run-state snapshot — server re-derives runningCellCount +
      // runningByRowId from the freshly-updated sidecar via countRunningCells.
      // Without this, the counter and row gutter button stay stale until the
      // user refetches manually.
      queryClient.invalidateQueries({ queryKey: tableKeys.activeDispatches(tableId) })
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
    onSuccess: (response, tableId) => {
      queryClient.setQueryData(tableKeys.detail(tableId), response.data.table)
      queryClient.removeQueries({ queryKey: tableKeys.rowsRoot(tableId) })
    },
    onSettled: (_data, _error, tableId) => {
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: tableKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId) }),
        queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) }),
      ])
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
      // Text fields must precede the file part: the server parses the body as a
      // stream and needs workspaceId before it reaches the (large) file.
      const formData = new FormData()
      formData.append('workspaceId', workspaceId)
      formData.append('file', file)

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

interface ImportCsvAsyncParams {
  workspaceId: string
  file: File
  onProgress?: (percent: number) => void
}

/**
 * Uploads a CSV/TSV straight to workspace storage (bypassing the server's request-body
 * cap) and returns its storage key. Shared by the async-import kickoff hooks.
 */
async function uploadCsvToWorkspaceStorage(
  file: File,
  workspaceId: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const upload = await runUploadStrategy({
    file,
    workspaceId,
    context: 'workspace',
    presignedEndpoint: `/api/workspaces/${workspaceId}/files/presigned`,
    onProgress: onProgress ? (event) => onProgress(event.percent) : undefined,
  })
  return upload.key
}

/**
 * Uploads a large CSV/TSV straight to storage, then kicks off a background import into a
 * new table. Resolves with `{ tableId, importId }` immediately — load progress and the
 * terminal state arrive over the table-events SSE stream (see `useTableEventStream`).
 */
export function useImportCsvAsync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId, file, onProgress }: ImportCsvAsyncParams) => {
      const fileKey = await uploadCsvToWorkspaceStorage(file, workspaceId, onProgress)
      const response = await requestJson(importTableAsyncContract, {
        body: { workspaceId, fileKey, fileName: file.name },
      })
      return response.data
    },
    onError: (error) => {
      logger.error('Failed to start async CSV import:', error)
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
    },
  })
}

export type CsvImportMode = 'append' | 'replace'

interface ImportCsvIntoTableAsyncParams {
  workspaceId: string
  tableId: string
  file: File
  mode: CsvImportMode
  mapping?: CsvHeaderMapping
  createColumns?: string[]
  onProgress?: (percent: number) => void
}

/**
 * Async append/replace import into an existing table for large files: uploads straight to
 * storage (bypassing the server's request-body cap), then kicks off the background worker.
 * Resolves immediately; progress + completion arrive over the table-events SSE stream.
 */
export function useImportCsvIntoTableAsync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      tableId,
      file,
      mode,
      mapping,
      createColumns,
      onProgress,
    }: ImportCsvIntoTableAsyncParams) => {
      const fileKey = await uploadCsvToWorkspaceStorage(file, workspaceId, onProgress)
      const response = await requestJson(importIntoTableAsyncContract, {
        params: { tableId },
        body: { workspaceId, fileKey, fileName: file.name, mode, mapping, createColumns },
      })
      return response.data
    },
    onError: (error) => {
      logger.error('Failed to start async CSV import:', error)
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, variables) => {
      invalidateRowCount(queryClient, variables.tableId)
    },
  })
}

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
      // Text fields must precede the file part: the server parses the body as a
      // stream and needs these fields before it reaches the (large) file.
      const formData = new FormData()
      formData.append('workspaceId', workspaceId)
      formData.append('mode', mode)
      if (mapping) {
        formData.append('mapping', JSON.stringify(mapping))
      }
      if (createColumns && createColumns.length > 0) {
        formData.append('createColumns', JSON.stringify(createColumns))
      }
      formData.append('file', file)

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
/**
 * Cancels an in-flight async import. Plain function (not a hook) because the import dropdown lists
 * multiple tables and cancels a chosen one by id rather than binding to a single table.
 */
export async function cancelTableImport(
  workspaceId: string,
  tableId: string,
  importId: string
): Promise<void> {
  await requestJson(cancelTableImportContract, {
    params: { tableId },
    body: { workspaceId, importId },
  })
}

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
  /** Cap the run to the first `max` eligible rows. Omit for an unbounded run.
   *  Optimistic stamping is skipped when set — the dispatcher's real pending
   *  stamps drive the UI for the actual capped rows. */
  limit?: RunLimit
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

/**
 * The single canonical run mutation. Every UI gesture (single cell, per-row
 * Play, action-bar Play/Refresh, column-header menu) maps to a `groupIds` +
 * optional `rowIds` shape. Optimistic patch flips targeted (row, group) cells
 * to `pending`; refetch on settle reconciles.
 */
export function useRunColumn({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ groupIds, runMode = 'all', rowIds, limit }: RunColumnVariables) => {
      return requestJson(runColumnContract, {
        params: { tableId },
        body: {
          workspaceId,
          groupIds,
          runMode,
          ...(rowIds && rowIds.length > 0 ? { rowIds } : {}),
          ...(limit ? { limit } : {}),
        },
      })
    },
    onMutate: async ({ groupIds, runMode = 'all', rowIds, limit }) => {
      // Capped runs touch only the first N eligible rows, chosen server-side by
      // position. We can't predict that set client-side, so optimistic stamping
      // is skipped — the dispatcher's real pending stamps (cell SSE) drive the
      // UI within the first window.
      if (limit)
        return { snapshots: undefined, runStateSnapshot: undefined, didBumpRunState: false }
      const targetRowIds = rowIds && rowIds.length > 0 ? new Set(rowIds) : null
      const targetGroupIds = new Set(groupIds)
      const groups =
        queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))?.schema
          .workflowGroups ?? []
      const groupsById = new Map(groups.map((g) => [g.id, g]))
      // Tally cells stamped per row to bump the run-state counter in lockstep.
      const stampedByRow: Record<string, number> = {}
      const snapshots = await snapshotAndMutateRows(queryClient, tableId, (r) => {
        if (targetRowIds && !targetRowIds.has(r.id)) return null
        const executions = r.executions ?? {}
        let stamped = 0
        const next: RowExecutions = { ...executions }
        const nextData = { ...r.data }
        for (const groupId of targetGroupIds) {
          const exec = executions[groupId] as RowExecutionMetadata | undefined
          if (isExecInFlight(exec)) continue
          const group = groupsById.get(groupId)
          // Mirror server eligibility: rows with unmet deps are skipped by the
          // dispatcher regardless of mode. Stamping pending here would leave
          // the cell flashing Queued indefinitely (no SSE event will arrive).
          if (group && !areGroupDepsSatisfied(group, r)) continue
          // Mirror server eligibility for manual `mode: 'incomplete'`: a
          // `completed` group is done (even with a blank output) — only "Run
          // all" re-runs it. error/cancelled/never-run cells still re-run.
          if (runMode === 'incomplete' && exec?.status === 'completed') continue
          next[groupId] = buildPendingExec(exec)
          // Mirror the server-side bulk clear: wipe output values so the cell
          // doesn't render the stale completed value behind a pending badge.
          // Without this the cell-render path's "value wins" branch keeps
          // showing the previous run's output and the Queued/Running pill
          // never appears.
          if (group) {
            for (const o of group.outputs) {
              if (o.columnName in nextData) nextData[o.columnName] = null
            }
          }
          stamped++
        }
        if (stamped === 0) return null
        stampedByRow[r.id] = stamped
        return { ...r, data: nextData, executions: next }
      })

      // Badge counts the whole run scope (rows × groups), matching the server's
      // dispatch-scope count — not just the loaded rows we could stamp. For
      // Run-all that's the table's totalCount; for a scoped run, the rowIds.
      const scopeRowCount = targetRowIds
        ? targetRowIds.size
        : (readTableRowCount(queryClient, tableId) ?? Object.keys(stampedByRow).length)
      const cellCountDelta = scopeRowCount * targetGroupIds.size
      const bumped = bumpRunState(queryClient, tableId, stampedByRow, cellCountDelta)
      return { snapshots, runStateSnapshot: bumped?.snapshot, didBumpRunState: bumped !== null }
    },
    onError: (_err, _variables, context) => {
      if (context?.snapshots) restoreCachedWorkflowCells(queryClient, context.snapshots)
      // Roll back the optimistic counter bump (snapshot may be undefined).
      if (context?.didBumpRunState) {
        queryClient.setQueryData(tableKeys.activeDispatches(tableId), context.runStateSnapshot)
      }
    },
    onSuccess: (data, { groupIds, runMode = 'all', rowIds, limit }, context) => {
      // Seed the dispatch into the overlay (drives resolveCellExec for
      // ahead-of-cursor rows) from the response — refetching would reset the
      // optimistic counter to the server's still-zero count.
      const dispatchId = data?.data?.dispatchId
      if (!dispatchId) {
        // No dispatch created → no SSE to reconcile the bump; roll it back.
        if (context?.didBumpRunState) {
          queryClient.setQueryData(tableKeys.activeDispatches(tableId), context.runStateSnapshot)
        }
        return
      }
      queryClient.setQueryData<TableRunState>(tableKeys.activeDispatches(tableId), (prev) => {
        const base = prev ?? { dispatches: [], runningCellCount: 0, runningByRowId: {} }
        if (base.dispatches.some((d) => d.id === dispatchId)) return base
        const dispatch: ActiveDispatch = {
          id: dispatchId,
          status: 'pending',
          mode: runMode,
          isManualRun: true,
          cursor: -1,
          scope: {
            groupIds,
            ...(rowIds && rowIds.length > 0 ? { rowIds } : {}),
          },
          ...(limit ? { limit } : {}),
        }
        return { ...base, dispatches: [...base.dispatches, dispatch] }
      })
    },
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
      // Mirror the one-shot "schedule existing rows on creation" flag to the
      // group's persisted autoRun. Without this it defaults to `true`, so an
      // autoRun=false group opens a dispatch the scheduler then skips per-cell
      // ('autoRun-off') — a no-op run that flashes the "X running" badge.
      return requestJson(addWorkflowGroupContract, {
        params: { tableId },
        body: { workspaceId, group, outputColumns, autoRun: group.autoRun },
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
  inputMappings?: UpdateWorkflowGroupBodyInput['inputMappings']
  deploymentMode?: UpdateWorkflowGroupBodyInput['deploymentMode']
  type?: UpdateWorkflowGroupBodyInput['type']
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
