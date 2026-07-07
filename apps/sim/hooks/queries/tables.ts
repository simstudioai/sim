'use client'

/**
 * React Query hooks for managing user-defined tables.
 */

import { toast } from '@sim/emcn'
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
import { useRouter } from 'next/navigation'
import { extractValidationIssues, isValidationError } from '@/lib/api/client/errors'
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
  cancelTableJobContract,
  cancelTableRunsContract,
  createTableContract,
  createTableRowContract,
  type DeleteTableRowsAsyncBody,
  deleteTableColumnContract,
  deleteTableContract,
  deleteTableRowContract,
  deleteTableRowsAsyncContract,
  deleteTableRowsContract,
  deleteWorkflowGroupContract,
  exportDownloadContract,
  exportTableAsyncContract,
  findTableRowsContract,
  getEnrichmentDetailContract,
  getTableContract,
  type InsertTableRowBodyInput,
  importIntoTableAsyncContract,
  importTableAsyncContract,
  listActiveDispatchesContract,
  listTableJobsContract,
  listTableRowsContract,
  listTablesContract,
  type RunLimit,
  type RunMode,
  renameTableContract,
  restoreTableContract,
  runColumnContract,
  type TableFindMatch,
  type TableIdParamsInput,
  type TableJobSummary,
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
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import type {
  CsvHeaderMapping,
  EnrichmentRunDetail,
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
import { getColumnId } from '@/lib/table/column-keys'
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  areGroupDepsSatisfied,
  isExecInFlight,
  optimisticallyScheduleNewlyEligibleGroups,
} from '@/lib/table/deps'
import { runUploadStrategy } from '@/lib/uploads/client/direct-upload'
import { useTimezone } from '@/hooks/queries/general-settings'
import {
  TABLE_LIST_STALE_TIME,
  type TableQueryScope,
  tableKeys,
} from '@/hooks/queries/utils/table-keys'
import {
  getNextTableRowsPageParam,
  type TableRowsPageParam,
} from '@/hooks/queries/utils/table-rows-pagination'

const logger = createLogger('TableQueries')
export const TABLE_DETAIL_STALE_TIME = 30 * 1000
export const TABLE_RUN_STATE_STALE_TIME = 30 * 1000
export const TABLE_FIND_STALE_TIME = 30 * 1000
export const TABLE_ROWS_STALE_TIME = 30 * 1000
export const TABLE_EXPORT_JOBS_STALE_TIME = 5 * 1000

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
  after,
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
      after,
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

/**
 * Invalidate only the row-count surfaces — the table detail and the tables
 * list, both of which carry the unfiltered `rowCount`. Deliberately leaves
 * `rowsRoot` (the rows infinite query) untouched so an offset-paginated refetch
 * can't resolve late and clobber rows already spliced in optimistically. Use
 * for inserts, where `reconcileCreatedRow` is the source of truth for the rows
 * cache and its `totalCount`.
 *
 * `rowsRoot` is nested under `detail` (`[...detail(tableId), 'rows']`), so the
 * detail invalidation MUST be `exact` — a prefix match would cascade into the
 * rows queries and trigger the very refetch this helper exists to avoid.
 */
function invalidateRowCountSurfaces(
  queryClient: ReturnType<typeof useQueryClient>,
  tableId: string
) {
  queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId), exact: true })
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
    staleTime: TABLE_LIST_STALE_TIME,
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
  // rq-lint-allow: tableId is a globally-unique id; workspaceId is only an authz scope on the fetch and cannot collide across workspaces
  return useQuery({
    queryKey: tableKeys.detail(tableId ?? ''),
    queryFn: ({ signal }) => fetchTable(workspaceId as string, tableId as string, signal),
    enabled: Boolean(workspaceId && tableId),
    staleTime: TABLE_DETAIL_STALE_TIME,
  })
}

/**
 * Shared table-detail query options so non-component callers (e.g. selector
 * providers) can `ensureQueryData` the same cache entry `useTable` populates.
 */
export function getTableDetailQueryOptions(workspaceId: string, tableId: string) {
  return {
    queryKey: tableKeys.detail(tableId),
    queryFn: ({ signal }: { signal?: AbortSignal }) => fetchTable(workspaceId, tableId, signal),
    staleTime: TABLE_DETAIL_STALE_TIME,
  }
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

async function fetchEnrichmentDetail(
  tableId: string,
  rowId: string,
  groupId: string,
  signal?: AbortSignal
): Promise<EnrichmentRunDetail | null> {
  const response = await requestJson(getEnrichmentDetailContract, {
    params: { tableId, rowId, groupId },
    signal,
  })
  return response.data.detail
}

/**
 * Enrichment cascade breakdown for one cell, fetched on demand when the
 * enrichment details panel opens. Kept off the hot grid read — only queried
 * while `enabled` (panel open with a selected row + group).
 *
 * `staleTime: 0` so reopening the panel always refetches: a cell can be re-run
 * between opens (the run writes new `enrichmentDetails` in the background with no
 * client invalidation), and the panel is opened on demand, so a fresh fetch per
 * open keeps the cascade in sync without a cached stale run.
 */
export function useEnrichmentDetail(
  tableId: string,
  rowId: string | null,
  groupId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: tableKeys.enrichmentDetail(tableId, rowId ?? '', groupId ?? ''),
    queryFn: ({ signal }) =>
      fetchEnrichmentDetail(tableId, rowId as string, groupId as string, signal),
    enabled: Boolean(tableId && rowId && groupId) && (options?.enabled ?? true),
    staleTime: 0,
  })
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
    staleTime: TABLE_RUN_STATE_STALE_TIME,
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

export function tableRowsParamsKey({
  pageSize,
  filter,
  sort,
}: Pick<InfiniteTableRowsParams, 'pageSize' | 'filter' | 'sort'>): string {
  return JSON.stringify({ pageSize, filter: filter ?? null, sort: sort ?? null })
}

interface FindTableRowsParams {
  workspaceId: string
  tableId: string
  q: string
  filter?: Filter | null
  sort?: Sort | null
}

export interface TableFindResult {
  matches: TableFindMatch[]
  truncated: boolean
}

async function fetchTableRowMatches({
  workspaceId,
  tableId,
  q,
  filter,
  sort,
  signal,
}: FindTableRowsParams & { signal?: AbortSignal }): Promise<TableFindResult> {
  const response = await requestJson(findTableRowsContract, {
    params: { tableId },
    query: { workspaceId, q, filter: filter ?? undefined, sort: sort ?? undefined },
    signal,
  })
  return response.data
}

/**
 * Server-side find across all cells. `q` is the *submitted* term (search is
 * Enter-triggered), so React Query caches each submitted term and re-searching
 * a prior one is instant. Disabled while `q` is empty.
 */
export function useFindTableRows({ workspaceId, tableId, q, filter, sort }: FindTableRowsParams) {
  const paramsKey = JSON.stringify({ q, filter: filter ?? null, sort: sort ?? null })
  return useQuery({
    queryKey: tableKeys.find(tableId, paramsKey),
    queryFn: ({ signal }) =>
      fetchTableRowMatches({ workspaceId, tableId, q, filter, sort, signal }),
    enabled: Boolean(workspaceId && tableId) && q.trim().length > 0,
    staleTime: TABLE_FIND_STALE_TIME,
    placeholderData: keepPreviousData,
  })
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
    queryFn: ({ pageParam, signal }) => {
      const param = pageParam as TableRowsPageParam
      return fetchTableRows({
        workspaceId,
        tableId,
        limit: pageSize,
        ...(typeof param === 'number' ? { offset: param } : { after: param }),
        filter,
        sort,
        includeTotal: param === 0,
        signal,
      })
    },
    initialPageParam: 0 as TableRowsPageParam,
    // Termination comes from hasMoreTableRows (empty page / totalCount covered) — never from
    // rows.length < pageSize, so a short server page can't be misread as end-of-table.
    // Default order pages by keyset cursor — each page is an index seek on (order_key, id),
    // where OFFSET would re-scan every prior row (O(N²) across a deep scroll / full drain).
    // Sorted views (and legacy rows without an order key) fall back to offset paging.
    getNextPageParam: (_lastPage, allPages): TableRowsPageParam | undefined =>
      getNextTableRowsPageParam(allPages, Boolean(sort)),
    staleTime: TABLE_ROWS_STALE_TIME,
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
    // Unlike row writes, table naming has no inline validation surface — the
    // issue message (e.g. the NAME_PATTERN rule) must reach the user as a toast.
    onError: (error) => {
      toast.error(extractValidationIssues(error)[0]?.message ?? error.message, { duration: 5000 })
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
    // Inline rename reverts the field on failure with no message of its own, so
    // the validation issue (e.g. the NAME_PATTERN rule) must surface as a toast.
    onError: (error) => {
      toast.error(extractValidationIssues(error)[0]?.message ?? error.message, { duration: 5000 })
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
/**
 * Toasts a failed row write. A plan row-limit failure (the best-effort cap in
 * `assertRowCapacity`) gets an "Upgrade" action routing to the explore-plans page;
 * other errors are a plain auto-dismissing toast. Validation errors are surfaced
 * inline, not here.
 */
function notifyRowWriteError(error: Error, onUpgrade: () => void): void {
  if (isValidationError(error)) return
  if (error.message.toLowerCase().includes('row limit')) {
    toast.error(error.message, {
      action: { label: 'Upgrade', onClick: onUpgrade },
    })
    return
  }
  toast.error(error.message, { duration: 5000 })
}

export function useCreateTableRow({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()
  const router = useRouter()

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

      // `reconcileCreatedRow` only patches the default-order view. Filtered /
      // column-sorted rows queries can't be reconciled from that heuristic
      // (membership, sort position, and `totalCount` are query-specific), so
      // refetch them — active ones update now, inactive ones on next view. The
      // default view stays optimistic, so the common case never refetches.
      queryClient.invalidateQueries({
        queryKey: tableKeys.rowsRoot(tableId),
        exact: false,
        predicate: (query) => !isDefaultOrderRowsQuery(query.queryKey),
      })
    },
    onError: (error) =>
      notifyRowWriteError(error, () => router.push(buildUpgradeHref(workspaceId, 'tables'))),
    onSettled: () => {
      // `reconcileCreatedRow` (onSuccess) is the source of truth for the rows
      // cache + its `totalCount`; only refresh the count surfaces here so a late
      // offset refetch can't clobber freshly-inserted rows (insert-flicker).
      invalidateRowCountSurfaces(queryClient, tableId)
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
  queryClient.setQueriesData<InfiniteData<TableRowsResponse, TableRowsPageParam>>(
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
 * A cached rows query whose ordering matches {@link reconcileCreatedRow}'s
 * orderKey/position heuristic: the default view with no active filter or sort.
 * Filtered or column-sorted variants encode a non-null `filter`/`sort` in their
 * params key — their membership, order, and `totalCount` are query-specific, so
 * an optimistic splice can't be trusted there (they're refetched instead). The
 * `find`/`write` subtrees aren't row-list data and never match.
 */
function isDefaultOrderRowsQuery(queryKey: readonly unknown[]): boolean {
  if (queryKey.includes('find') || queryKey.includes('write')) return false
  const last = queryKey[queryKey.length - 1]
  if (typeof last !== 'string') return false
  try {
    const params = JSON.parse(last) as { filter?: unknown; sort?: unknown }
    return params.filter == null && params.sort == null
  } catch {
    return false
  }
}

/**
 * Splice a server-returned new row into the paginated row cache. Bumps the
 * `position` of any cached row at or past the new row's position, then inserts
 * the row into the overlapping page (or appends to the last page when the
 * position lies past everything fetched).
 *
 * Scoped to the default-order rows queries only — the orderKey/position
 * heuristic matches the unfiltered, unsorted server order, not an active filter
 * or column sort. Filtered/sorted queries are refetched by the caller.
 */
function reconcileCreatedRow(
  queryClient: ReturnType<typeof useQueryClient>,
  tableId: string,
  row: TableRow
) {
  queryClient.setQueriesData<InfiniteData<TableRowsResponse, TableRowsPageParam>>(
    {
      queryKey: tableKeys.rowsRoot(tableId),
      exact: false,
      predicate: (query) => isDefaultOrderRowsQuery(query.queryKey),
    },
    (old) => {
      if (!old) return old
      if (old.pages.some((p) => p.rows.some((r) => r.id === row.id))) return old

      // Use key-ordering only when the new row AND every cached row have an
      // `orderKey` — then no neighbor bump is needed and order is exact. If any
      // cached row is un-keyed (mid-backfill), fall back to the legacy `position`
      // path so un-keyed rows aren't yanked to the front by an empty-string sort.
      const byKey =
        row.orderKey != null && old.pages.every((p) => p.rows.every((r) => r.orderKey != null))
      // Compare order keys bytewise to match the server's `COLLATE "C"` ordering
      // and the `>=` checks in `fitsAfter` — `localeCompare` is locale-aware and
      // would place the new row in a different slot than the server (e.g. an
      // uppercase-prefixed key), leaving it visibly misordered until next reload.
      const sortRows = (rows: TableRow[]) =>
        byKey
          ? [...rows].sort((a, b) =>
              (a.orderKey as string) < (b.orderKey as string)
                ? -1
                : (a.orderKey as string) > (b.orderKey as string)
                  ? 1
                  : 0
            )
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
  const router = useRouter()

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
    onError: (error) =>
      notifyRowWriteError(error, () => router.push(buildUpgradeHref(workspaceId, 'tables'))),
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

      const previousQueries = queryClient.getQueriesData<
        InfiniteData<TableRowsResponse, TableRowsPageParam>
      >({
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

      const previousQueries = queryClient.getQueriesData<
        InfiniteData<TableRowsResponse, TableRowsPageParam>
      >({
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

interface DeleteTableRowsAsyncVariables {
  /** Active filter; omit for a whole-table "select all". */
  filter?: DeleteTableRowsAsyncBody['filter']
  /** Active sort — together with `filter` it identifies the exact rows query to optimistically
   *  strip, so we don't clear unrelated cached views (other filters/sorts). */
  sort?: Sort | null
  /** Rows deselected after "select all" — spared by the job. */
  excludeRowIds?: string[]
  /** Doomed-row estimate shown in the confirm — persisted on the job so server counts can
   *  subtract the not-yet-deleted remainder mid-job. */
  estimatedCount?: number
}

/**
 * Kicks off a background "select all" delete (filter + optional exclusion set) instead of sending
 * every row id. Optimistically strips the rows from the *active* filter/sort view only (the one the
 * user is looking at) so the table empties instantly while the worker deletes in the background;
 * emptying that view's pages also drops `hasNextPage`, so scrolling won't reload not-yet-deleted
 * rows. Other cached views are left intact. The SSE job stream reconciles on completion (and
 * restores rows on failure/cancel).
 */
export function useDeleteTableRowsAsync({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      filter,
      excludeRowIds,
      estimatedCount,
    }: DeleteTableRowsAsyncVariables) => {
      return requestJson(deleteTableRowsAsyncContract, {
        params: { tableId },
        body: { workspaceId, filter, excludeRowIds, estimatedCount },
      })
    },
    onMutate: async ({ filter, sort, excludeRowIds, estimatedCount }) => {
      // Target the exact infinite-rows query for the view the user is on — not every cached view.
      const activeKey = tableKeys.infiniteRows(
        tableId,
        tableRowsParamsKey({ pageSize: TABLE_LIMITS.MAX_QUERY_LIMIT, filter: filter ?? null, sort })
      )
      await queryClient.cancelQueries({ queryKey: activeKey })
      const previousRows =
        queryClient.getQueryData<InfiniteData<TableRowsResponse, TableRowsPageParam>>(activeKey)
      const previousDetail = queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))
      const keep = new Set(excludeRowIds ?? [])
      // The active view's post-delete total is exactly the kept (deselected) rows — every other
      // matching row is doomed. Without this the footer / select-all label stays at the old total
      // until the job's terminal refetch.
      queryClient.setQueryData<InfiniteData<TableRowsResponse, TableRowsPageParam>>(
        activeKey,
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  rows: page.rows.filter((r) => keep.has(r.id)),
                  ...(page.totalCount != null ? { totalCount: keep.size } : {}),
                })),
              }
            : old
      )
      if (estimatedCount != null) {
        queryClient.setQueryData<TableDefinition>(tableKeys.detail(tableId), (p) =>
          p ? { ...p, rowCount: Math.max(0, p.rowCount - estimatedCount) } : p
        )
      }
      return { activeKey, previousRows, previousDetail }
    },
    onSuccess: ({ data }) => {
      // Lock the SSE job consumer onto this run so its running/terminal events are accepted, and
      // flip the list-driven tray into "deleting" without waiting for a poll.
      queryClient.setQueryData<TableDefinition>(tableKeys.detail(tableId), (p) =>
        p ? { ...p, jobStatus: 'running', jobId: data.jobId, jobType: 'delete' } : p
      )
      queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
    },
    onError: (error, _vars, context) => {
      // Restore the optimistically-removed rows — the kickoff failed, nothing was deleted.
      if (context?.activeKey && context.previousRows) {
        queryClient.setQueryData(context.activeKey, context.previousRows)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(tableKeys.detail(tableId), context.previousDetail)
      }
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
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
        // `columnName` is the column id (first-party) or name (legacy); match
        // either. A rename is metadata-only and never moves id-keyed row data,
        // so we only patch the schema column's name — never `row.data` keys.
        // Stamp the current storage id so `getColumnId` stays stable as the
        // display name changes (mirrors the server's metadata-only rename).
        const lower = columnName.toLowerCase()
        const isRename = typeof (updates as { name?: string }).name === 'string'
        const nextColumns = previousDetail.schema.columns.map((c) => {
          if (getColumnId(c) !== columnName && c.name.toLowerCase() !== lower) return c
          const next = { ...c, ...updates }
          if (isRename && next.id === undefined) next.id = getColumnId(c)
          return next
        })
        queryClient.setQueryData<TableDefinition>(tableKeys.detail(tableId), {
          ...previousDetail,
          schema: { ...previousDetail.schema, columns: nextColumns },
        })
      }

      return { previousDetail }
    },
    onError: (error, _vars, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(tableKeys.detail(tableId), context.previousDetail)
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
      // exact: rowsRoot nests under detail, so a prefix match would needlessly refetch all rows
      queryClient.invalidateQueries({ queryKey: tableKeys.detail(tableId), exact: true })
    },
  })
}

interface CancelRunsParams {
  scope: 'all' | 'row'
  rowId?: string
  /** Scope-`all` only: cancel just the cells on rows matching this filter (filtered select-all Stop). */
  filter?: Filter
  /** Active sort — with `filter` it identifies the exact rows query whose cells the optimistic
   *  cancel may flip (other cached views contain rows the server won't touch). */
  sort?: Sort | null
  /** Scope-`all` only: deselected rows whose cells keep running. */
  excludeRowIds?: string[]
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
    mutationFn: async ({ scope, rowId, filter, excludeRowIds }: CancelRunsParams) => {
      return requestJson(cancelTableRunsContract, {
        params: { tableId },
        body: { workspaceId, scope, rowId, filter, excludeRowIds },
      })
    },
    onMutate: async ({ scope, rowId, filter, sort, excludeRowIds }) => {
      const excludedRowIds =
        excludeRowIds && excludeRowIds.length > 0 ? new Set(excludeRowIds) : null
      // A filtered stop only cancels matching rows server-side — flipping every cached view
      // would show rows outside the filter as cancelled until refetch. Scope the optimistic
      // flip to the active filtered view; onSettled's invalidation reconciles the rest.
      const onlyKey = filter
        ? tableKeys.infiniteRows(
            tableId,
            tableRowsParamsKey({
              pageSize: TABLE_LIMITS.MAX_QUERY_LIMIT,
              filter,
              sort: sort ?? null,
            })
          )
        : undefined
      const snapshots = await snapshotAndMutateRows(
        queryClient,
        tableId,
        (r) => {
          if (scope === 'row' && r.id !== rowId) return null
          if (excludedRowIds?.has(r.id)) return null
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
        },
        { onlyKey }
      )
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
  const timezone = useTimezone()

  return useMutation({
    mutationFn: async ({ workspaceId, file }: UploadCsvParams) => {
      // Text fields must precede the file part: the server parses the body as a
      // stream and needs workspaceId before it reaches the (large) file.
      const formData = new FormData()
      formData.append('workspaceId', workspaceId)
      formData.append('timezone', timezone)
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
  const timezone = useTimezone()
  return useMutation({
    mutationFn: async ({ workspaceId, file, onProgress }: ImportCsvAsyncParams) => {
      const fileKey = await uploadCsvToWorkspaceStorage(file, workspaceId, onProgress)
      const response = await requestJson(importTableAsyncContract, {
        body: { workspaceId, fileKey, fileName: file.name, timezone },
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

interface ImportFileAsTableParams {
  workspaceId: string
  fileKey: string
  fileName: string
}

/**
 * Kicks off a background import into a new table from a file ALREADY in workspace storage
 * (e.g. the file viewer's "Import as a table"). Reuses the existing object — no re-upload —
 * and sets `deleteSourceFile: false` so the user's original file survives the import (the normal
 * upload-import flow deletes its single-use copy). Resolves with `{ tableId, importId }`; progress
 * and the terminal state arrive over the table-events SSE stream.
 */
export function useImportFileAsTable() {
  const queryClient = useQueryClient()
  const timezone = useTimezone()
  return useMutation({
    mutationFn: async ({ workspaceId, fileKey, fileName }: ImportFileAsTableParams) => {
      const response = await requestJson(importTableAsyncContract, {
        body: { workspaceId, fileKey, fileName, deleteSourceFile: false, timezone },
      })
      return response.data
    },
    onError: (error) => {
      logger.error('Failed to start import from file:', error)
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
  const timezone = useTimezone()
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
        body: { workspaceId, fileKey, fileName: file.name, mode, mapping, createColumns, timezone },
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
  const timezone = useTimezone()

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
      formData.append('timezone', timezone)
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
 * Cancels an in-flight async table job (import or delete). Plain function (not a hook) because the
 * job tray lists multiple tables and cancels a chosen one by id rather than binding to a single
 * table.
 */
export async function cancelTableJob(
  workspaceId: string,
  tableId: string,
  jobId: string
): Promise<void> {
  await requestJson(cancelTableJobContract, {
    params: { tableId },
    body: { workspaceId, jobId },
  })
}

async function fetchWorkspaceExportJobs(
  workspaceId: string,
  signal?: AbortSignal
): Promise<TableJobSummary[]> {
  const response = await requestJson(listTableJobsContract, {
    query: { workspaceId, type: 'export' },
    signal,
  })
  return response.data.jobs
}

/**
 * Export jobs for the header tray: running ones plus recent terminals (re-downloadable). Polls
 * while any export is in flight; otherwise the SSE job stream invalidates this key on export
 * events, so the list stays fresh without a steady poll.
 */
export function useWorkspaceExportJobs(workspaceId?: string) {
  return useQuery({
    queryKey: tableKeys.exportJobs(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceExportJobs(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: TABLE_EXPORT_JOBS_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.some((j) => j.status === 'running') ? 2000 : false,
  })
}

/**
 * Export jobs this session kicked off. The SSE buffer replays up to an hour of events on every
 * (re)connect, so the job stream consumer must only auto-download `ready` events for exports the
 * user just initiated — not replayed ones from a previous visit.
 */
const initiatedExportJobIds = new Set<string>()

/** Consumes (one-shot) whether this session initiated the export job. */
export function consumeInitiatedExport(jobId: string): boolean {
  return initiatedExportJobIds.delete(jobId)
}

/**
 * Kicks off a background export job for large tables (small ones stream synchronously via
 * {@link downloadTableExport}). The SSE job stream auto-downloads the file when the job is ready.
 */
export function useExportTableAsync({ workspaceId, tableId }: RowMutationContext) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ format }: { format: 'csv' | 'json' }) => {
      const response = await requestJson(exportTableAsyncContract, {
        params: { tableId },
        body: { workspaceId, format },
      })
      initiatedExportJobIds.add(response.data.jobId)
      return response.data
    },
    onSuccess: () => {
      // Surface the new running job in the tray immediately — its poll only
      // self-sustains once a running job is already in the cache.
      void queryClient.invalidateQueries({ queryKey: tableKeys.exportJobs(workspaceId) })
    },
    onError: (error) => {
      if (isValidationError(error)) return
      toast.error(error.message, { duration: 5000 })
    },
  })
}

/** Resolves a ready export job to its presigned URL and triggers the browser download. */
export async function downloadExportResult(
  workspaceId: string,
  tableId: string,
  jobId: string
): Promise<void> {
  const response = await requestJson(exportDownloadContract, {
    params: { tableId },
    query: { workspaceId, jobId },
  })
  const a = document.createElement('a')
  a.href = response.data.url
  a.download = response.data.fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
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
      // The grid deletes by stable id; legacy callers may pass a name. Resolve
      // the column's storage id once from either form, then strip schema,
      // widths, and row data by that single id — all three are id-keyed, so a
      // name arg with a distinct id must never be used as the strip key directly.
      const target = previousDetail?.schema.columns.find(
        (c) => getColumnId(c) === columnName || c.name.toLowerCase() === lower
      )
      const stripKey = target ? getColumnId(target) : columnName

      if (previousDetail) {
        const nextColumns = previousDetail.schema.columns.filter((c) => getColumnId(c) !== stripKey)
        const prevWidths = previousDetail.metadata?.columnWidths
        const nextMetadata = prevWidths
          ? {
              ...previousDetail.metadata,
              columnWidths: Object.fromEntries(
                Object.entries(prevWidths).filter(([k]) => k !== stripKey)
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
        if (!(stripKey in row.data)) return null
        const { [stripKey]: _removed, ...rest } = row.data
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
  /** "Select all under a filter" — run every row matching this filter (mutually exclusive with
   *  `rowIds`). Optimistic stamping is skipped (like `limit`) since the matching set isn't known
   *  client-side; the dispatcher's real pending stamps drive the UI. */
  filter?: Filter
  /** Select-all scope only: deselected rows — skipped by the dispatcher and the optimistic stamp. */
  excludeRowIds?: string[]
  /** Cap the run to the first `max` eligible rows. Omit for an unbounded run.
   *  Optimistic stamping is skipped when set — the dispatcher's real pending
   *  stamps drive the UI for the actual capped rows. */
  limit?: RunLimit
}

type InfiniteRowsCache = { pages: TableRowsResponse[]; pageParams: TableRowsPageParam[] }
/**
 * Cache shapes that hold table-row data under the `rowsRoot(tableId)` prefix.
 * Optimistic mutations walk every entry defensively, handling both the
 * single-page and infinite (`useInfiniteTableRows`) shapes.
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
  options?: {
    cancelInFlight?: boolean
    /** Restrict the walk to one exact cached query (e.g. the active filtered
     *  view) when the mutation's server effect doesn't cover other views. */
    onlyKey?: readonly unknown[]
  }
): Promise<RowsCacheSnapshots> {
  const scope = options?.onlyKey
    ? ({ queryKey: options.onlyKey, exact: true } as const)
    : ({ queryKey: tableKeys.rowsRoot(tableId) } as const)
  if (options?.cancelInFlight !== false) {
    await queryClient.cancelQueries(scope)
  }
  const matching = queryClient.getQueriesData<RowsCacheEntry>(scope)
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
    mutationFn: async ({
      groupIds,
      runMode = 'all',
      rowIds,
      filter,
      excludeRowIds,
      limit,
    }: RunColumnVariables) => {
      return requestJson(runColumnContract, {
        params: { tableId },
        body: {
          workspaceId,
          groupIds,
          runMode,
          ...(rowIds && rowIds.length > 0 ? { rowIds } : {}),
          ...(filter ? { filter } : {}),
          ...(excludeRowIds && excludeRowIds.length > 0 ? { excludeRowIds } : {}),
          ...(limit ? { limit } : {}),
        },
      })
    },
    onMutate: async ({ groupIds, runMode = 'all', rowIds, filter, excludeRowIds, limit }) => {
      // Capped and filtered runs target a set we can't predict client-side (capped picks the first
      // N by position; filtered matches a server-evaluated predicate), so optimistic stamping is
      // skipped — the dispatcher's real pending stamps (cell SSE) drive the UI within the first
      // window.
      if (limit || filter)
        return { snapshots: undefined, runStateSnapshot: undefined, didBumpRunState: false }
      const targetRowIds = rowIds && rowIds.length > 0 ? new Set(rowIds) : null
      const excludedRowIds =
        excludeRowIds && excludeRowIds.length > 0 ? new Set(excludeRowIds) : null
      const targetGroupIds = new Set(groupIds)
      const groups =
        queryClient.getQueryData<TableDefinition>(tableKeys.detail(tableId))?.schema
          .workflowGroups ?? []
      const groupsById = new Map(groups.map((g) => [g.id, g]))
      // Tally cells stamped per row to bump the run-state counter in lockstep.
      const stampedByRow: Record<string, number> = {}
      const snapshots = await snapshotAndMutateRows(queryClient, tableId, (r) => {
        if (targetRowIds && !targetRowIds.has(r.id)) return null
        if (excludedRowIds?.has(r.id)) return null
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
