'use client'

import { useCallback } from 'react'
import { isApiClientError } from '@/lib/api/client/errors'
import { PUBLIC_TABLE_PAGE_SIZE } from '@/lib/api/contracts/public-interfaces'
import type { ColumnDefinition, TableRow } from '@/lib/table/types'
import { usePublicInterfaceTableRows } from '@/hooks/queries/public-interfaces'
import { type TableRowsResponse, useInfiniteTableRows, useTable } from '@/hooks/queries/tables'
import type { ResourceSource } from '@/resources'
import { shareTableSchema } from '@/resources/table-source'

/**
 * Rows per request in workspace scope. Sized so the first paint fills a panel
 * without a second round trip.
 *
 * Owned here rather than taken from the caller, so two hosts of this view cannot
 * key differently: `pageSize` is part of the infinite-rows query key.
 *
 * KNOWN GAP — this does *not* yet share a cache entry with the tables page,
 * which requests `TABLE_LIMITS.MAX_QUERY_LIMIT` (1000) because its grid drains
 * every row for client-side sort and filter. Opening a table and viewing it in a
 * panel therefore drains it twice. Unifying them is a real behaviour change on
 * one surface or the other — either the page fetches in 100s or a panel fetches
 * 1000 rows up front — so it is deliberately not smuggled into this move.
 *
 * A share source uses {@link PUBLIC_TABLE_PAGE_SIZE} instead — the public
 * contract's hard `limit` ceiling, read from the contract rather than restated.
 */
export const TABLE_VIEW_PAGE_SIZE = 100

/** The one page shape both scopes produce. */
type TablePage = Pick<TableRowsResponse, 'rows' | 'totalCount'>

export interface UseTableSourceResult {
  /** `null` while the schema is still resolving, or when it could not be resolved. */
  columns: ColumnDefinition[] | null
  rows: TableRow[]
  /** Server-side `COUNT(*)` from the first page; `null` when the server did not report one. */
  totalCount: number | null
  isPending: boolean
  /** The reference is dangling — the table is gone, not merely unreachable. */
  isMissing: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
}

/**
 * Whether a load failure proves the table reference is dangling.
 *
 * Only a 404 establishes that. Every other failure — offline, a 5xx, an expired
 * session — is transient and leaves the reference perfectly valid, so reporting
 * it as a deleted table would send the viewer off to un-wire something still
 * correct.
 */
function isMissingTable(error: unknown): boolean {
  return isApiClientError(error) && error.status === 404
}

/**
 * Resolves a table's schema and rows from whichever address the source carries,
 * so {@link TableView} renders one way in every scope.
 *
 * Against a workspace source the schema comes from the shared table detail query
 * — keyed on the table id alone, so every host of a given table shares one entry
 * — and rows page in through the shared infinite-rows query. Rows are *not* yet
 * fully shared with the tables page; see {@link TABLE_VIEW_PAGE_SIZE}.
 *
 * Against a share source the schema was already resolved server-side (the page
 * proved the stored grant before rendering anything) and arrives in the seed;
 * only rows are fetched, from a route addressed by `(token, grantId)` alone.
 * There is no table id on the wire there, so a visitor cannot address a table
 * the share does not grant.
 *
 * Both branches' hooks run on every render — the inactive one is
 * `enabled: false` — so hook order is fixed regardless of source.
 */
export function useTableSource(source: ResourceSource<'table'>): UseTableSourceResult {
  const isWorkspaceScope = source.via === 'workspace'

  const tableQuery = useTable(
    source.via === 'workspace' ? source.workspaceId : undefined,
    source.via === 'workspace' ? source.resourceId : undefined
  )
  const workspaceRows = useInfiniteTableRows({
    workspaceId: source.via === 'workspace' ? source.workspaceId : '',
    tableId: source.via === 'workspace' ? source.resourceId : '',
    pageSize: TABLE_VIEW_PAGE_SIZE,
    enabled: isWorkspaceScope,
  })
  const shareRows = usePublicInterfaceTableRows({
    token: source.via === 'share' ? source.token : '',
    moduleId: source.via === 'share' ? source.grantId : '',
    pageSize: PUBLIC_TABLE_PAGE_SIZE,
    enabled: !isWorkspaceScope,
  })

  /** The one scope's rows query every scope-independent read goes through. */
  const activeRows = isWorkspaceScope ? workspaceRows : shareRows

  const fetchNextPageFn = activeRows.fetchNextPage
  const fetchNextPage = useCallback(() => {
    void fetchNextPageFn()
  }, [fetchNextPageFn])

  const pages: TablePage[] = activeRows.data?.pages ?? []
  const rowsSettled = activeRows.data !== undefined
  const rowsError = activeRows.isError ? activeRows.error : null

  /**
   * A rows failure is only fatal before anything has loaded. Once pages are in
   * hand, an error means a *scroll-triggered* page failed — the loaded rows are
   * still valid, and replacing them with a dangling-reference message would be
   * both wrong and destructive.
   */
  const loadError =
    isWorkspaceScope && tableQuery.isError ? tableQuery.error : rowsSettled ? null : rowsError

  return {
    columns: isWorkspaceScope
      ? (tableQuery.data?.schema.columns ?? null)
      : shareTableSchema(source).columns,
    rows: pages.flatMap((page) => page.rows),
    totalCount: pages[0]?.totalCount ?? null,
    isPending: (isWorkspaceScope && tableQuery.isPending) || activeRows.isPending,
    isMissing: isMissingTable(loadError),
    isError: loadError !== null,
    hasNextPage: activeRows.hasNextPage,
    isFetchingNextPage: activeRows.isFetchingNextPage,
    fetchNextPage,
  }
}
