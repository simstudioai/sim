'use client'

import { useCallback } from 'react'
import { interfaceModuleSeed } from '@/components/resources/interface-view/interface-scope'
import { useResourceOfKind } from '@/components/resources/resource-provider'
import { isApiClientError } from '@/lib/api/client/errors'
import { PUBLIC_TABLE_PAGE_SIZE } from '@/lib/api/contracts/public-interfaces'
import type { InterfaceModule } from '@/lib/interfaces/types'
import type { ColumnDefinition, TableRow } from '@/lib/table/types'
import { usePublicInterfaceTableRows } from '@/hooks/queries/public-interfaces'
import { type TableRowsResponse, useInfiniteTableRows, useTable } from '@/hooks/queries/tables'

/**
 * Rows per request in the workspace. Sized so the first paint fills a full-page
 * cell without a second round trip.
 *
 * A share source uses {@link PUBLIC_TABLE_PAGE_SIZE} instead — that is the
 * public contract's hard `limit` ceiling, and requesting more than it would be
 * rejected at the boundary, so the value is read from the contract rather than
 * restated here.
 */
export const MODULE_TABLE_PAGE_SIZE = 100

/** The one page shape both scopes produce. */
type ModuleTablePage = Pick<TableRowsResponse, 'rows' | 'totalCount'>

export interface UseModuleTableResult {
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
 * it as a deleted table would send the viewer off to un-wire a module that is
 * still correct.
 */
function isMissingTable(error: unknown): boolean {
  return isApiClientError(error) && error.status === 404
}

/**
 * Resolves a table module's schema and rows from whichever source the
 * interface is mounted against, so `TableModule` renders one way in both.
 *
 * Against a workspace source the schema comes from the table detail query and rows
 * page in through the shared infinite-rows query — the same cache entries the
 * Tables surface populates, so an open table and an interface module never
 * double-fetch.
 *
 * Against a share source the schema was already resolved server-side (the page
 * proved the module's stored reference before it rendered anything) and arrives
 * in the interface's seed; only rows are fetched, from a route addressed by
 * `(token, moduleId)` alone. There is no table id on the wire there, so a
 * visitor cannot address a table the interface does not use.
 *
 * Both branches' hooks run on every render — the inactive one is `enabled:
 * false` — so the hook order is fixed regardless of source.
 */
export function useModuleTable(
  module: Extract<InterfaceModule, { type: 'table' }>
): UseModuleTableResult {
  const { source } = useResourceOfKind('interface')
  const { tableId } = module.config

  const isWorkspaceScope = source.via === 'workspace'
  const moduleSeed = interfaceModuleSeed(source, module.id)
  const sharedTable = moduleSeed?.kind === 'table' ? moduleSeed.seed : null

  const tableQuery = useTable(
    source.via === 'workspace' ? source.workspaceId : undefined,
    isWorkspaceScope ? (tableId ?? undefined) : undefined
  )
  const workspaceRows = useInfiniteTableRows({
    workspaceId: source.via === 'workspace' ? source.workspaceId : '',
    tableId: tableId ?? '',
    pageSize: MODULE_TABLE_PAGE_SIZE,
    enabled: isWorkspaceScope && Boolean(tableId),
  })
  const shareRows = usePublicInterfaceTableRows({
    token: source.via === 'share' ? source.token : '',
    moduleId: module.id,
    pageSize: PUBLIC_TABLE_PAGE_SIZE,
    enabled: !isWorkspaceScope,
  })

  /** The one scope's rows query every scope-independent read goes through. */
  const activeRows = isWorkspaceScope ? workspaceRows : shareRows

  const fetchNextPageFn = activeRows.fetchNextPage
  const fetchNextPage = useCallback(() => {
    void fetchNextPageFn()
  }, [fetchNextPageFn])

  const pages: ModuleTablePage[] = activeRows.data?.pages ?? []
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
      : (sharedTable?.columns ?? null),
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
