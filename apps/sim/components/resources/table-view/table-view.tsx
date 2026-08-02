'use client'

import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sim/emcn'
import { Table as TableIcon } from '@sim/emcn/icons'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
import { getColumnId } from '@/lib/table/column-keys'
import type { ResourceGrants, ResourceHost, ResourceSource } from '@/resources'
import { tableWorkspaceId } from '@/resources/table-source'
import { CellContent } from './cells'
import { useTableSource } from './hooks/use-table-source'
import { expandToDisplayColumns } from './utils'

/** Distance from the bottom of the scroller at which the next page is requested. */
const PREFETCH_PX = 200

/** Stable keys for the loading placeholder rows. */
const LOADING_ROW_KEYS = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5'] as const

export interface TableViewProps {
  source: ResourceSource<'table'>
  /**
   * Declared and deliberately unread. This view has no write or run path in any
   * scope, so there is nothing for a grant to unlock — but the axis stays on the
   * signature because it is the contract every canonical unit is mounted
   * through, and because the day this grows an editor the capability must come
   * from here rather than from a consumer inventing a flag.
   */
  grants: ResourceGrants
  /**
   * Declared and deliberately unread, for the same reason. This view writes no
   * URL state and holds no router, which is what makes it safe in all three
   * hosts; the prop records that rather than leaving it implicit.
   */
  host: ResourceHost
}

/**
 * One table's real contents, from whichever address its {@link ResourceSource}
 * carries — so the same view serves an embedded panel and an anonymous share.
 *
 * Deliberately not the table editor: no sorting, filtering, resizing, selection
 * or cell editing. Those live in the route's `TableGrid`, which owns the write
 * path. What this shares with the editor is the part that matters for reading —
 * {@link CellContent} — so booleans, dates, JSON, links, currency, select pills
 * and workflow-output state all render exactly as they do in the grid rather
 * than being approximated per surface.
 *
 * `workspaceId` is threaded from the source and is `undefined` in share scope.
 * That is the security seam, not an optimisation: the `sim-resource` chip's
 * renderer mounts workspace-authenticated list queries, and without a workspace
 * id the resolver never emits that kind. See `cells/cell-render.test.ts`.
 */
export function TableView({ source }: TableViewProps) {
  const {
    columns,
    rows,
    totalCount,
    isPending,
    isMissing,
    isError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useTableSource(source)

  /**
   * Pages in the next batch as the scroller nears its end. Guarded on
   * `hasNextPage` so the final page never fires a request, and on
   * `isFetchingNextPage` so a fast scroll cannot queue duplicates.
   */
  function handleScroll(event: React.UIEvent<HTMLDivElement>): void {
    if (!hasNextPage || isFetchingNextPage) return
    const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
    if (scrollHeight - scrollTop - clientHeight > PREFETCH_PX) return
    fetchNextPage()
  }

  if (isError) {
    /**
     * Deliberately not `source.unavailableCopy`. Two reasons: its wording is
     * generic where these are specific ("no longer in the workspace" tells an
     * owner what to fix), and the share arm here is an information-leak
     * decision — a visitor is never told the table lived in a workspace,
     * because naming one would leak that the share belongs to it.
     */
    const missingMessage =
      source.via === 'workspace'
        ? 'This table is no longer in the workspace.'
        : 'This table is no longer available.'
    return (
      <ResourceEmptyState
        icon={TableIcon}
        description={isMissing ? missingMessage : 'This table could not be loaded.'}
      />
    )
  }

  if (isPending) {
    return (
      <div className='flex h-full flex-col gap-2 p-3'>
        {LOADING_ROW_KEYS.map((key) => (
          <Skeleton key={key} className='h-[20px] w-full' />
        ))}
      </div>
    )
  }

  if (!columns || columns.length === 0) {
    return <ResourceEmptyState icon={TableIcon} description='This table has no columns yet.' />
  }

  if (rows.length === 0) {
    return <ResourceEmptyState icon={TableIcon} description='This table has no rows yet.' />
  }

  /**
   * Workflow groups are absent by design: a share's seed carries the column
   * schema and nothing about runs, and the public rows contract reads with
   * `withExecutions: false`. Workflow-output columns therefore resolve on the
   * value path in every scope this view serves.
   */
  const displayColumns = expandToDisplayColumns(columns, [])
  const workspaceId = tableWorkspaceId(source) ?? undefined
  const remaining = totalCount !== null && totalCount > rows.length

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div onScroll={handleScroll} className='min-h-0 flex-1 overflow-auto overscroll-contain'>
        <Table>
          <TableHeader>
            <TableRow>
              {displayColumns.map((column) => (
                <TableHead key={column.key} className='whitespace-nowrap'>
                  {column.headerLabel}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          {/**
           * EMCN's `TableBody` drops the last row's rule (`[&_tr:last-child]:border-0`)
           * so a table can sit flush against a page. Inside a panel the rows end
           * mid-pane instead, and without the closing line the list looks
           * truncated — restored here. `!` because that rule targets the same
           * `tr:last-child` and would otherwise out-specify a row-level class.
           */}
          <TableBody className='[&_tr:last-child]:!border-b'>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {displayColumns.map((column) => (
                  <TableCell key={column.key} className='relative max-w-[240px]'>
                    {/**
                     * The row rhythm is this view's concern, not the cell's. In the
                     * grid an empty cell renders `null` and the row keeps its height
                     * from the virtualizer; here there is nothing holding it open, so
                     * an all-empty row would collapse to its padding. The floor lives
                     * on a wrapper rather than in `CellRender` so the grid is
                     * unaffected.
                     */}
                    <span className='flex min-h-[20px] items-center'>
                      <CellContent
                        value={row.data[getColumnId(column)]}
                        column={column}
                        workspaceId={workspaceId}
                        isEditing={false}
                      />
                    </span>
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
