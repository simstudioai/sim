'use client'

/**
 * React Query hooks for managing user-defined tables.
 */

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { useSocket } from '@/app/workspace/providers/socket-provider'
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

export interface TableRowsResponse {
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
  const rows = (data.rows || []) as TableRow[]
  if (rows.length > 0 && rows.length <= 5) {
    const summary = rows.map((r) => ({
      id: r.id,
      exec: Object.fromEntries(
        Object.entries(r.executions ?? {}).map(([gid, e]) => [gid, e?.status ?? null])
      ),
    }))
    logger.info(`[FLASH-DEBUG] fetch /rows returned ${JSON.stringify(summary)}`)
  }
  return { rows, totalCount: data.totalCount ?? null }
}

function invalidateRowData(queryClient: ReturnType<typeof useQueryClient>, tableId: string) {
  queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
}

function invalidateRowCount(
  queryClient: ReturnType<typeof useQueryClient>,
  tableId: string
) {
  queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId) })
  queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
}

function invalidateTableSchema(
  queryClient: ReturnType<typeof useQueryClient>,
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
      if (queryClient.isMutating() > 0) {
        logger.info(
          `[FLASH-DEBUG] socket row=${event.rowId} (mutation in flight → invalidate) incomingExec=${JSON.stringify(incomingExec)}`
        )
        queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
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
            `[FLASH-DEBUG] socket merge row=${event.rowId} prevExec=${JSON.stringify(prevExec)} incomingExec=${JSON.stringify(incomingExec)}`
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
        queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(tableId) })
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
      invalidateRowCount(queryClient, tableId)
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
      const snapshots = await snapshotAndMutateRows(queryClient, tableId, (r) => {
        if (scope === 'row' && r.id !== rowId) return null
        const executions = (r.executions ?? {}) as RowExecutions
        let rowTouched = false
        const nextExecutions: RowExecutions = { ...executions }
        for (const gid in executions) {
          const exec = executions[gid]
          if (exec.status !== 'running' && exec.status !== 'pending') continue
          nextExecutions[gid] = {
            status: 'cancelled',
            executionId: exec.executionId ?? null,
            jobId: null,
            workflowId: exec.workflowId,
            error: 'Cancelled',
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
 * Delete a column from a table.
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
    }: ImportCsvIntoTableParams): Promise<ImportCsvIntoTableResponse> => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('workspaceId', workspaceId)
      formData.append('mode', mode)
      if (mapping) {
        formData.append('mapping', JSON.stringify(mapping))
      }

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
      const res = await fetch(
        `/api/table/${tableId}/groups/${encodeURIComponent(groupId)}/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, mode }),
        }
      )

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to run group')
      }

      return res.json() as Promise<{ success: boolean; data: { triggered: number } }>
    },
    onMutate: async ({ groupId, workflowId, mode = 'all' }) => {
      const snapshots = await snapshotAndMutateRows(queryClient, tableId, (r) => {
        const exec = (r.executions ?? {})[groupId] as RowExecutionMetadata | undefined
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
