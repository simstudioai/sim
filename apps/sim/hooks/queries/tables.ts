'use client'

/**
 * React Query hooks for managing user-defined tables.
 */

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  ColumnDefinition,
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
import { useSocket } from '@/app/workspace/providers/socket-provider'

/** Short poll to surface running → completed transitions from the server without a dedicated realtime channel. */
const ROWS_POLL_INTERVAL_WHILE_RUNNING_MS = 1500

function hasRunningGroupExecution(rows: TableRow[] | undefined): boolean {
  if (!rows) return false
  for (const row of rows) {
    const executions = row.executions ?? {}
    for (const key in executions) {
      const exec = executions[key]
      if (exec?.status === 'running' || exec?.status === 'pending') return true
    }
  }
  return false
}

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
  rows: (tableId: string, paramsKey: string) =>
    [...tableKeys.rowsRoot(tableId), paramsKey] as const,
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

function createRowsParamsKey({
  limit,
  offset,
  filter,
  sort,
  includeTotal,
}: Omit<TableRowsParams, 'workspaceId' | 'tableId'>): string {
  return JSON.stringify({
    limit,
    offset,
    filter: filter ?? null,
    sort: sort ?? null,
    includeTotal: includeTotal ?? true,
  })
}

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
  if (rows.length > 0 && rows.length <= 10) {
    const summary = rows.map((r) => ({
      id: r.id,
      exec: Object.fromEntries(
        Object.entries(r.executions ?? {}).map(([gid, e]) => [gid, e?.status ?? null])
      ),
    }))
    logger.info(`[STOP-DEBUG] fetch /rows returned ${JSON.stringify(summary)}`)
  }
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

/**
 * Fetch rows for a table with pagination/filter/sort.
 *
 * Subscribes to the realtime `table-row-updated` / `table-row-deleted` socket
 * events for this `tableId`; on receipt, merges the delta into every cached
 * rows query for the table via `setQueriesData`. Polling stays as a fallback
 * gated on `!isConnected` so a brief disconnect window doesn't go stale.
 */
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
  const queryClient = useQueryClient()
  const paramsKey = createRowsParamsKey({ limit, offset, filter, sort, includeTotal })
  const {
    isConnected: socketConnected,
    joinTable,
    leaveTable,
    onTableRowUpdated,
    onTableRowDeleted,
  } = useSocket()

  useEffect(() => {
    if (!tableId) return
    joinTable(tableId)

    onTableRowUpdated((event) => {
      if (event.tableId !== tableId) return
      const incomingExec = Object.fromEntries(
        Object.entries(
          (event.executions as Record<string, { status?: string }> | undefined) ?? {}
        ).map(([gid, e]) => [gid, e?.status ?? null])
      )
      // While an optimistic mutation is in flight, applying the socket delta
      // could clobber the optimistic state — defer to onSettled invalidate.
      // Mark stale without triggering a refetch (refetchType: 'none') so the
      // refetch races neither the in-flight optimistic update nor any
      // server-side post-response work the mutation is awaiting (e.g. backfill).
      if (queryClient.isMutating() > 0) {
        queryClient.invalidateQueries({
          queryKey: tableKeys.rowsRoot(tableId),
          refetchType: 'none',
        })
        return
      }
      queryClient.setQueriesData<TableRowsResponse>(
        { queryKey: tableKeys.rowsRoot(tableId) },
        (current) => {
          if (!current) return current
          const incoming: TableRow = {
            id: event.rowId,
            data: event.data as RowData,
            executions: (event.executions as RowExecutions) ?? {},
            position: event.position,
            createdAt: '',
            updatedAt:
              typeof event.updatedAt === 'string' ? event.updatedAt : String(event.updatedAt),
          }
          const idx = current.rows.findIndex((r) => r.id === event.rowId)
          if (idx === -1) {
            const next = [...current.rows, incoming].sort((a, b) => a.position - b.position)
            return {
              ...current,
              rows: next,
              totalCount: current.totalCount === null ? null : current.totalCount + 1,
            }
          }
          const prevExec = Object.fromEntries(
            Object.entries(current.rows[idx].executions ?? {}).map(([gid, e]) => [
              gid,
              e?.status ?? null,
            ])
          )
          logger.info(
            `[STOP-DEBUG] socket merge row=${event.rowId} prev=${JSON.stringify(prevExec)} incoming=${JSON.stringify(incomingExec)}`
          )
          const merged = {
            ...current.rows[idx],
            data: incoming.data,
            executions: incoming.executions,
            updatedAt: incoming.updatedAt,
          }
          const next = [...current.rows]
          next[idx] = merged
          return { ...current, rows: next }
        }
      )
    })

    onTableRowDeleted((event) => {
      if (event.tableId !== tableId) return
      if (queryClient.isMutating() > 0) {
        queryClient.invalidateQueries({
          queryKey: tableKeys.rowsRoot(tableId),
          refetchType: 'none',
        })
        return
      }
      queryClient.setQueriesData<TableRowsResponse>(
        { queryKey: tableKeys.rowsRoot(tableId) },
        (current) => {
          if (!current) return current
          const next = current.rows.filter((r) => r.id !== event.rowId)
          if (next.length === current.rows.length) return current
          return {
            ...current,
            rows: next,
            totalCount: current.totalCount === null ? null : Math.max(0, current.totalCount - 1),
          }
        }
      )
    })

    return () => {
      leaveTable()
    }
    // joinTable / leaveTable / on* are stable callbacks; tableId is the only real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId])

  return useQuery({
    queryKey: tableKeys.rows(tableId, paramsKey),
    queryFn: ({ signal }) =>
      fetchTableRows({
        workspaceId,
        tableId,
        limit,
        offset,
        filter,
        sort,
        includeTotal,
        signal,
      }),
    enabled: Boolean(workspaceId && tableId) && enabled,
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: keepPreviousData,
    // Polling is the fallback for when the socket isn't carrying updates.
    // - Pause while any mutation is in flight (optimistic-update guard).
    // - Skip while connected (sockets push every cell write).
    // - Otherwise poll only while a cell is in `running` state, the original cadence.
    refetchInterval: (query) => {
      if (queryClient.isMutating() > 0) return false
      if (socketConnected) return false
      return hasRunningGroupExecution(query.state.data?.rows)
        ? ROWS_POLL_INTERVAL_WHILE_RUNNING_MS
        : false
    },
    refetchIntervalInBackground: false,
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

      queryClient.setQueriesData<TableRowsResponse>(
        { queryKey: tableKeys.rowsRoot(tableId) },
        (old) => {
          if (!old) return old
          if (old.rows.some((r) => r.id === row.id)) return old
          const shifted = old.rows.map((r) =>
            r.position >= row.position ? { ...r, position: r.position + 1 } : r
          )
          const rows: TableRow[] = [...shifted, row].sort((a, b) => a.position - b.position)
          return {
            ...old,
            rows,
            totalCount: old.totalCount === null ? null : old.totalCount + 1,
          }
        }
      )
    },
    onSettled: () => {
      invalidateRowCount(queryClient, tableId)
    },
  })
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

      const previousQueries = queryClient.getQueriesData<TableRowsResponse>({
        queryKey: tableKeys.rowsRoot(tableId),
      })

      queryClient.setQueriesData<TableRowsResponse>(
        { queryKey: tableKeys.rowsRoot(tableId) },
        (old) => {
          if (!old) return old
          return {
            ...old,
            rows: old.rows.map((row) =>
              row.id === rowId ? { ...row, data: { ...row.data, ...data } as RowData } : row
            ),
          }
        }
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

      const previousQueries = queryClient.getQueriesData<TableRowsResponse>({
        queryKey: tableKeys.rowsRoot(tableId),
      })

      const updateMap = new Map(updates.map((u) => [u.rowId, u.data]))

      queryClient.setQueriesData<TableRowsResponse>(
        { queryKey: tableKeys.rowsRoot(tableId) },
        (old) => {
          if (!old) return old
          return {
            ...old,
            rows: old.rows.map((row) => {
              const patch = updateMap.get(row.id)
              if (!patch) return row
              return { ...row, data: { ...row.data, ...patch } as RowData }
            }),
          }
        }
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
    onError: (error) => {
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
      const res = await fetch(`/api/table/${tableId}/cancel-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, scope, rowId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || 'Failed to cancel runs')
      }
      return res.json() as Promise<{ success: true; data: { cancelled: number } }>
    },
    onMutate: async ({ scope, rowId }) => {
      logger.info(`[STOP-DEBUG] cancel onMutate scope=${scope} rowId=${rowId ?? 'all'}`)
      const snapshots = await snapshotAndMutateRows(queryClient, tableId, (r) => {
        if (scope === 'row' && r.id !== rowId) return null
        const executions = (r.executions ?? {}) as RowExecutions
        const before = Object.fromEntries(
          Object.entries(executions).map(([gid, e]) => [gid, e?.status ?? null])
        )
        let rowTouched = false
        const nextExecutions: RowExecutions = { ...executions }
        for (const gid in executions) {
          const exec = executions[gid]
          if (exec.status !== 'running' && exec.status !== 'pending') continue
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
        if (rowTouched) {
          const after = Object.fromEntries(
            Object.entries(nextExecutions).map(([gid, e]) => [gid, e?.status ?? null])
          )
          logger.info(
            `[STOP-DEBUG] cancel optimistic row=${r.id} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
          )
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
 * Delete a column from a table.
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
}

interface ImportCsvIntoTableOutcome {
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
    }: ImportCsvIntoTableParams): Promise<ImportCsvIntoTableOutcome> => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('workspaceId', workspaceId)
      formData.append('mode', mode)
      if (mapping) {
        formData.append('mapping', JSON.stringify(mapping))
      }

      // boundary-raw-fetch: multipart/form-data CSV upload, requestJson only supports JSON bodies
      const response = await fetch(`/api/table/${tableId}/import-csv`, {
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
      invalidateRowCount(queryClient, variables.tableId)
    },
    onError: (error) => {
      logger.error('Failed to import CSV into table:', error)
    },
  })
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
      invalidateTableSchema(queryClient, tableId)
    },
  })
}

interface RunGroupVariables {
  groupId: string
  /** Workflow id sourced from the group's config — used as a fallback for the
   *  optimistic execution `workflowId` field when the row hasn't run before. */
  workflowId: string
  /**
   * `all` — fire every dep-satisfied row (default).
   * `incomplete` — only rows that have never run or whose last run ended in
   * `failed`/`aborted`. Mirrored by the server-side filter.
   */
  mode?: 'all' | 'incomplete'
}

type RowsCacheSnapshots = Array<[ReadonlyArray<unknown>, TableRowsResponse]>

/**
 * Walks every cached row-list under `tableId`, applies `transform` to each row,
 * and snapshots the originals for rollback. Returns `null` if no row was touched
 * — callers can use that to skip a useless invalidation cycle.
 *
 * `transform(row)` returns the next row to write, or `null` to leave it. The
 * common pattern is "matching cells flip state, others are skipped".
 */
export async function snapshotAndMutateRows(
  queryClient: ReturnType<typeof useQueryClient>,
  tableId: string,
  transform: (row: TableRow) => TableRow | null
): Promise<RowsCacheSnapshots> {
  await queryClient.cancelQueries({ queryKey: tableKeys.rowsRoot(tableId) })
  const matching = queryClient.getQueriesData<TableRowsResponse>({
    queryKey: tableKeys.rowsRoot(tableId),
  })
  const snapshots: RowsCacheSnapshots = []
  for (const [key, data] of matching) {
    if (!data) continue
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
 * Trigger a workflow-group run for every eligible row in the table. The server
 * filters by deps; this hook optimistically flips each matching row's
 * `executions[groupId]` to `pending` immediately so the UI doesn't lag the
 * network round-trip.
 */
export function useRunGroup({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ groupId, mode = 'all' }: RunGroupVariables) => {
      const res = await fetch(`/api/table/${tableId}/groups/${encodeURIComponent(groupId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, mode }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to run group')
      }

      return res.json() as Promise<{ success: boolean; data: { triggered: number } }>
    },
    onMutate: async ({ groupId, workflowId, mode = 'all' }) => {
      const snapshots = await snapshotAndMutateRows(queryClient, tableId, (r) => {
        const exec = r.executions?.[groupId] as RowExecutionMetadata | undefined
        if (exec?.status === 'running' || exec?.status === 'pending') return null
        // Mirror the server-side `incomplete` filter so the optimistic update
        // doesn't flash `pending` on rows the server is going to skip.
        if (mode === 'incomplete' && exec?.status === 'completed') return null
        const pending: RowExecutionMetadata = {
          status: 'pending',
          executionId: exec?.executionId ?? null,
          jobId: null,
          workflowId: exec?.workflowId ?? workflowId,
          error: null,
        }
        return {
          ...r,
          executions: { ...(r.executions ?? {}), [groupId]: pending },
        }
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

// ───────────────────────── Workflow group mutations ─────────────────────────

interface AddWorkflowGroupVariables {
  group: WorkflowGroup
  outputColumns: ColumnDefinition[]
}

export function useAddWorkflowGroup({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ group, outputColumns }: AddWorkflowGroupVariables) => {
      const res = await fetch(`/api/table/${tableId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, group, outputColumns }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || 'Failed to add workflow group')
      }
      return res.json()
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
  newOutputColumns?: ColumnDefinition[]
}

export function useUpdateWorkflowGroup({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateWorkflowGroupVariables) => {
      const res = await fetch(`/api/table/${tableId}/groups`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, ...vars }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || 'Failed to update workflow group')
      }
      return res.json()
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
      const res = await fetch(`/api/table/${tableId}/groups`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, groupId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || 'Failed to delete workflow group')
      }
      return res.json()
    },
    onSettled: () => {
      invalidateTableSchema(queryClient, tableId)
      queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
    },
  })
}
