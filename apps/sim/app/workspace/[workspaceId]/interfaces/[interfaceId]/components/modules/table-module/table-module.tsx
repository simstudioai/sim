'use client'

import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sim/emcn'
import { Table as TableIcon } from '@sim/emcn/icons'
import { isApiClientError } from '@/lib/api/client/errors'
import type { InterfaceModule } from '@/lib/interfaces'
import { getColumnId } from '@/lib/table/column-keys'
import type { JsonValue } from '@/lib/table/types'
import { ModuleEmptyState } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/module-empty-state'
import type { InterfaceMode } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'
import { useInfiniteTableRows, useTable } from '@/hooks/queries/tables'

/** Rows per request. Sized so the first paint fills a full-page cell without a second round trip. */
const TABLE_MODULE_PAGE_SIZE = 100

/** Distance from the bottom of the scroller at which the next page is requested. */
const TABLE_MODULE_PREFETCH_PX = 200

/** Stable keys for the loading placeholder rows. */
const LOADING_ROW_KEYS = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5'] as const

export interface TableModuleProps {
  workspaceId: string
  /** Part of the uniform module contract; the table reads by table id alone. */
  interfaceId: string
  module: Extract<InterfaceModule, { type: 'table' }>
  /** Rows are read-only in both modes; only the unconfigured copy differs. */
  mode: InterfaceMode
}

/**
 * Whether a load failure proves the table reference is dangling.
 *
 * Only a 404 establishes that. Every other failure — offline, a 5xx, an expired
 * session — is transient and leaves the reference perfectly valid, so reporting
 * it as a deleted table would send the visitor off to un-wire a module that is
 * still correct.
 */
function isMissingTable(error: unknown): boolean {
  return isApiClientError(error) && error.status === 404
}

/** Renders one cell value as text. Objects and arrays fall back to compact JSON. */
function formatCellValue(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Read-only view of a workspace table.
 *
 * Deliberately not the table editor — no sorting, filtering, or cell editing —
 * but the rows are the real ones: it reads through the shared table query hooks
 * and pages in more as the visitor scrolls, so a large table is browsable rather
 * than truncated at the first page.
 */
export function TableModule({ workspaceId, module, mode }: TableModuleProps) {
  const { tableId } = module.config
  const tableQuery = useTable(workspaceId, tableId ?? undefined)
  const rowsQuery = useInfiniteTableRows({
    workspaceId,
    tableId: tableId ?? '',
    pageSize: TABLE_MODULE_PAGE_SIZE,
    enabled: Boolean(tableId),
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = rowsQuery

  /**
   * Pages in the next batch as the scroller nears its end. Guarded on
   * `hasNextPage` so the final page never fires a request, and on
   * `isFetchingNextPage` so a fast scroll cannot queue duplicates.
   */
  function handleScroll(event: React.UIEvent<HTMLDivElement>): void {
    if (!hasNextPage || isFetchingNextPage) return
    const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
    if (scrollHeight - scrollTop - clientHeight > TABLE_MODULE_PREFETCH_PX) return
    void fetchNextPage()
  }

  if (!tableId) {
    return (
      <ModuleEmptyState
        icon={TableIcon}
        message={
          mode === 'edit' ? 'Pick a table in the properties panel.' : 'This table is not available.'
        }
      />
    )
  }

  /**
   * A rows failure is only fatal before anything has loaded. Once pages are in
   * hand, `isError` means a *scroll-triggered* page failed — the loaded rows are
   * still valid, and replacing them with a dangling-reference message would be
   * both wrong and destructive.
   */
  const loadError = tableQuery.isError
    ? tableQuery.error
    : rowsQuery.isError && rowsQuery.data === undefined
      ? rowsQuery.error
      : null

  if (loadError) {
    return (
      <ModuleEmptyState
        icon={TableIcon}
        message={
          isMissingTable(loadError)
            ? 'This table is no longer in the workspace.'
            : 'This table could not be loaded.'
        }
      />
    )
  }

  if (tableQuery.isPending || rowsQuery.isPending) {
    return (
      <div className='flex h-full flex-col gap-2 p-3'>
        {LOADING_ROW_KEYS.map((key) => (
          <Skeleton key={key} className='h-[20px] w-full' />
        ))}
      </div>
    )
  }

  const columns = tableQuery.data?.schema.columns ?? []
  if (columns.length === 0) {
    return <ModuleEmptyState icon={TableIcon} message='This table has no columns yet.' />
  }

  const pages = rowsQuery.data?.pages ?? []
  const rows = pages.flatMap((page) => page.rows)
  if (rows.length === 0) {
    return <ModuleEmptyState icon={TableIcon} message='This table has no rows yet.' />
  }

  const totalCount = pages[0]?.totalCount ?? null
  const remaining = totalCount !== null && totalCount > rows.length

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div onScroll={handleScroll} className='min-h-0 flex-1 overflow-auto overscroll-contain'>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={getColumnId(column)} className='whitespace-nowrap'>
                  {column.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {columns.map((column) => (
                  <TableCell
                    key={getColumnId(column)}
                    className='max-w-[240px] truncate text-[var(--text-body)]'
                  >
                    {formatCellValue(row.data[getColumnId(column)])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {remaining ? (
        <p className='border-[var(--border)] border-t px-3 py-2 text-[var(--text-muted)] text-caption'>
          {isFetchingNextPage
            ? 'Loading more rows…'
            : `Showing ${rows.length} of ${totalCount} rows.`}
        </p>
      ) : null}
    </div>
  )
}
