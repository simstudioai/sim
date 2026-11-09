'use client'

import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  type ColumnDefinition,
  countLoadedTableRows,
  hasMoreTableRows,
  prunePredicateForColumns,
  type QueryOptions,
  resolveWorkflowGroupDeploymentMode,
  TABLE_LIMITS,
  type TableDefinition,
  type TablePredicate,
  type TableRow,
  tableRowsInfiniteOptions,
  useInfiniteTableRows,
  useTable as useTableQuery,
  type WorkflowGroup,
  type WorkflowMetadata,
} from '@/platform/lib/data/tables'
import { useWorkflowStates, useWorkflows } from '@/platform/lib/data/workflows'

/**
 * What a workflow-output column's header shows about the block that fills it: the block's type
 * (its mark), its name, and whether it is gone from the workflow.
 */
export interface ColumnSourceInfo {
  blockType?: string
  blockName?: string
  /** The workflow loaded but the column's source block no longer exists in it. */
  blockMissing?: boolean
}

const EMPTY_COLUMNS: ColumnDefinition[] = []
const EMPTY_GROUPS: WorkflowGroup[] = []

interface UseTableParams {
  workspaceId: string
  tableId: string
  queryOptions: QueryOptions
}

interface FetchNextPageResult {
  hasNextPage: boolean
}

export interface UseTableReturn {
  tableData: TableDefinition | undefined
  isLoadingTable: boolean
  /** Flattened across every fetched infinite-query page. */
  rows: TableRow[]
  /** Filter-scoped total row count (server COUNT(*) for the active filter); null until loaded. */
  rowTotal: number | null
  /**
   * The filter actually sent to the server: `queryOptions.filter` minus any
   * condition the current schema makes invalid. Anything server-bound —
   * select-all run/stop/delete — must scope with THIS, not the raw filter, or
   * the action targets a predicate the grid isn't displaying.
   */
  filter: TablePredicate | null
  isLoadingRows: boolean
  refetchRows: () => void
  /**
   * The resolved value's `hasNextPage` reflects the post-fetch cache state —
   * read from this rather than the hook's `hasNextPage`, which only updates on
   * the next React render.
   */
  fetchNextPage: () => Promise<FetchNextPageResult>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  workflows: WorkflowMetadata[] | undefined
  columns: ColumnDefinition[]
  tableWorkflowGroups: WorkflowGroup[]
  /** Headers read from this map instead of each subscribing to its own workflow-state query. */
  columnSourceInfo: Map<string, ColumnSourceInfo>
  /**
   * Fetches any missing pages then returns the full flat row list from cache.
   * Safe to read immediately — no React re-render required. Gate bulk ops that
   * need the complete row set behind this.
   */
  ensureAllRowsLoaded: () => Promise<TableRow[]>
  /**
   * Pages until the cache holds at least `maxRows` rows (or no more pages
   * exist), then returns the first `maxRows` from cache plus whether more
   * remain. Unlike {@link ensureAllRowsLoaded} it stops early, so size-bound
   * ops (clipboard copy) don't drain an entire large table. Filter/sort-aware.
   */
  ensureRowsLoadedUpTo: (maxRows: number) => Promise<{ rows: TableRow[]; hasMore: boolean }>
}

/**
 * The table, its rows (paged 1,000 at a time, filter- and sort-aware) and the workflow context its
 * columns need. Ported from the legacy page's hook; the only change is that a workflow column's
 * header reads its source block's type rather than the block registry's icon component, which the
 * zone cannot render. Local interaction state (drag, resize, selection, editing) stays in the grid:
 * moving it here would push every keystroke through this hook and re-render everything.
 */
export function useTable({ workspaceId, tableId, queryOptions }: UseTableParams): UseTableReturn {
  const queryClient = useQueryClient()
  const { data: tableData, isLoading: isLoadingTable } = useTableQuery(workspaceId, tableId)

  // Applied filters outlive the schema they were built against: converting a
  // column to `select`, or toggling its `multiple`, can strand an operator the
  // server rejects outright, which would fail every subsequent rows query. Prune
  // here, above every consumer of the rows query key, so the paged helpers below
  // can't rebuild the key from the unpruned filter and drift.
  const filter = useMemo(
    () => prunePredicateForColumns(queryOptions.filter ?? null, tableData?.schema?.columns ?? []),
    [queryOptions.filter, tableData?.schema?.columns]
  )

  const {
    data: rowsData,
    isLoading: isLoadingRows,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteTableRows({
    workspaceId,
    tableId,
    pageSize: TABLE_LIMITS.MAX_QUERY_LIMIT,
    filter,
    sort: queryOptions.sort,
    enabled: Boolean(workspaceId && tableId),
  })

  const rows = useMemo<TableRow[]>(
    () => rowsData?.pages.flatMap((p) => p.rows) ?? [],
    [rowsData?.pages]
  )

  // Server-side COUNT(*) for the active filter (page 0 only). Null until the first page lands;
  // callers fall back to the table's unfiltered `rowCount`. This is the true "select all" total —
  // it reflects the filter, unlike `tableData.rowCount`.
  const rowTotal = useMemo<number | null>(
    () => rowsData?.pages[0]?.totalCount ?? null,
    [rowsData?.pages]
  )

  const refetchRows = useCallback(() => {
    void refetch()
  }, [refetch])

  const ensureAllRowsLoaded = useCallback(async (): Promise<TableRow[]> => {
    if (!workspaceId || !tableId) return []

    const opts = tableRowsInfiniteOptions({
      workspaceId,
      tableId,
      pageSize: TABLE_LIMITS.MAX_QUERY_LIMIT,
      filter,
      sort: queryOptions.sort,
    })

    // getQueryData bypasses React's render cycle — pages added by fetchNextPage
    // are visible synchronously after each await without waiting for a re-render.
    while (true) {
      const pages = queryClient.getQueryData(opts.queryKey)?.pages ?? []
      if (!hasMoreTableRows(pages)) break
      const result = await fetchNextPage()
      if (result.status === 'error') {
        throw result.error ?? new Error('Failed to load table rows')
      }
      const after = queryClient.getQueryData(opts.queryKey)?.pages.length ?? 0
      if (after <= pages.length) {
        // A cancelQueries race (optimistic mutation) can resolve the fetch without
        // appending a page; retrying would spin forever on the same state.
        throw new Error('Table rows pagination made no progress')
      }
    }

    return queryClient.getQueryData(opts.queryKey)?.pages.flatMap((p) => p.rows) ?? []
  }, [workspaceId, tableId, filter, queryOptions.sort, queryClient, fetchNextPage])

  const ensureRowsLoadedUpTo = useCallback(
    async (maxRows: number): Promise<{ rows: TableRow[]; hasMore: boolean }> => {
      if (!workspaceId || !tableId) return { rows: [], hasMore: false }

      const opts = tableRowsInfiniteOptions({
        workspaceId,
        tableId,
        pageSize: TABLE_LIMITS.MAX_QUERY_LIMIT,
        filter,
        sort: queryOptions.sort,
      })

      // Load one past the cap when needed so `hasMore` is exact: with the cap
      // covered but hasMoreTableRows still true, row `maxRows + 1` confirms it.
      while (true) {
        const pages = queryClient.getQueryData(opts.queryKey)?.pages ?? []
        if (countLoadedTableRows(pages) > maxRows || !hasMoreTableRows(pages)) break
        const result = await fetchNextPage()
        if (result.status === 'error') {
          throw result.error ?? new Error('Failed to load table rows')
        }
        const after = queryClient.getQueryData(opts.queryKey)?.pages.length ?? 0
        if (after <= pages.length) {
          throw new Error('Table rows pagination made no progress')
        }
      }

      const pages = queryClient.getQueryData(opts.queryKey)?.pages ?? []
      const all = pages.flatMap((p) => p.rows)
      return {
        rows: all.length > maxRows ? all.slice(0, maxRows) : all,
        hasMore: all.length > maxRows || hasMoreTableRows(pages),
      }
    },
    [workspaceId, tableId, filter, queryOptions.sort, queryClient, fetchNextPage]
  )

  const fetchNextPageWrapped = useCallback(async () => {
    const result = await fetchNextPage()
    if (result.status === 'error') {
      throw result.error ?? new Error('Failed to fetch next page')
    }
    return { hasNextPage: Boolean(result.hasNextPage) }
  }, [fetchNextPage])

  const { data: workflows } = useWorkflows(workspaceId)

  const columns = useMemo(
    () => tableData?.schema?.columns || EMPTY_COLUMNS,
    [tableData?.schema?.columns]
  )

  const tableWorkflowGroups = useMemo<WorkflowGroup[]>(
    () => tableData?.schema?.workflowGroups ?? EMPTY_GROUPS,
    [tableData?.schema?.workflowGroups]
  )

  const workflowStates = useWorkflowStates(
    useMemo(() => tableWorkflowGroups.map((g) => g.workflowId), [tableWorkflowGroups])
  )

  const columnSourceInfo = useMemo<Map<string, ColumnSourceInfo>>(() => {
    const map = new Map<string, ColumnSourceInfo>()
    for (const group of tableWorkflowGroups) {
      // Enrichment groups have no workflow blocks; their output columns render with the standard
      // column-type glyph (the group header already carries the enrichment's glyph).
      if (group.type === 'enrichment') continue
      const state = workflowStates.get(group.workflowId)
      const blocks = (state as { blocks?: Record<string, { type?: string; name?: string }> } | null)
        ?.blocks
      // Only the live draft is fetched, so "block missing" can only be judged for live-mode
      // groups; a deployed-mode group runs a graph that is not loaded here.
      const isLiveMode = resolveWorkflowGroupDeploymentMode(group) === 'live'
      for (const out of group.outputs) {
        const block = blocks?.[out.blockId]
        // Flag a missing source block only once the workflow state has loaded, so a
        // still-loading workflow never flashes the badge.
        map.set(out.columnName, {
          blockType: block?.type,
          blockName: block?.name?.trim() || undefined,
          blockMissing: Boolean(isLiveMode && blocks && out.blockId && !block),
        })
      }
    }
    return map
  }, [tableWorkflowGroups, workflowStates])

  return {
    tableData,
    isLoadingTable,
    rows,
    rowTotal,
    filter,
    isLoadingRows,
    refetchRows,
    fetchNextPage: fetchNextPageWrapped,
    hasNextPage: Boolean(hasNextPage),
    isFetchingNextPage,
    workflows,
    columns,
    tableWorkflowGroups,
    columnSourceInfo,
    ensureAllRowsLoaded,
    ensureRowsLoadedUpTo,
  }
}
