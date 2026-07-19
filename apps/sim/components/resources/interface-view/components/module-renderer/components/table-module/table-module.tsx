'use client'

import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sim/emcn'
import { Table as TableIcon } from '@sim/emcn/icons'
import { ModuleResourcePicker } from '@/components/resources/interface-view/components/module-renderer/components/module-resource-picker'
import { TableCellValue } from '@/components/resources/interface-view/components/module-renderer/components/table-module/components/table-cell-value'
import { useModuleTable } from '@/components/resources/interface-view/components/module-renderer/components/table-module/hooks/use-module-table'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
import { useResourceOfKind } from '@/components/resources/resource-provider'
import type { InterfaceModule } from '@/lib/interfaces/types'
import { getColumnId } from '@/lib/table/column-keys'

/** Distance from the bottom of the scroller at which the next page is requested. */
const TABLE_MODULE_PREFETCH_PX = 200

/** Stable keys for the loading placeholder rows. */
const LOADING_ROW_KEYS = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5'] as const

export interface TableModuleProps {
  module: Extract<InterfaceModule, { type: 'table' }>
  /**
   * Present only where this module may bind its own table — see
   * `ModuleRenderer`. There is no `mode` here: rows are read-only in every
   * scope, so the only thing edit mode ever changed was whether the module
   * could be bound, which is exactly what this prop's presence now says.
   */
  onConfigChange?: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
}

/**
 * Read-only view of a workspace table.
 *
 * Deliberately not the table editor — no sorting, filtering, or cell editing —
 * but the rows are the real ones: {@link useModuleTable} resolves them from the
 * surrounding resource and pages in more as the visitor scrolls, so a
 * large table is browsable rather than truncated at the first page. The same
 * component serves the editor and a public share; only the source differs.
 *
 * An unbound module authors itself: given `onConfigChange` it renders the same
 * chooser column the empty cell offered a moment earlier, so picking the table
 * happens where the module is rather than in the inspector.
 */
export function TableModule({ module, onConfigChange }: TableModuleProps) {
  const { source } = useResourceOfKind('interface')
  const { tableId } = module.config
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
  } = useModuleTable(module)

  /**
   * Pages in the next batch as the scroller nears its end. Guarded on
   * `hasNextPage` so the final page never fires a request, and on
   * `isFetchingNextPage` so a fast scroll cannot queue duplicates.
   */
  function handleScroll(event: React.UIEvent<HTMLDivElement>): void {
    if (!hasNextPage || isFetchingNextPage) return
    const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
    if (scrollHeight - scrollTop - clientHeight > TABLE_MODULE_PREFETCH_PX) return
    fetchNextPage()
  }

  if (source.via === 'workspace' && !tableId) {
    if (onConfigChange) {
      return (
        <ModuleResourcePicker
          kind='table'
          workspaceId={source.workspaceId}
          onSelect={(next) => onConfigChange(module.id, { tableId: next }, true)}
        />
      )
    }
    return <ResourceEmptyState icon={TableIcon} description='This table is not available.' />
  }

  if (isError) {
    /**
     * A visitor is not told where the table lived — "in the workspace" is
     * internal state on a public page, and naming it would leak that the share
     * belongs to one.
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
          {/**
           * EMCN's `TableBody` drops the last row's rule (`[&_tr:last-child]:border-0`)
           * so a table can sit flush against a page. Inside a module the rows
           * end mid-pane instead, and without the closing line the list looks
           * truncated — restored here. `!` because that rule targets the same
           * `tr:last-child` and would otherwise out-specify a row-level class.
           */}
          <TableBody className='[&_tr:last-child]:!border-b'>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {columns.map((column) => (
                  <TableCell key={getColumnId(column)} className='max-w-[240px]'>
                    <TableCellValue value={row.data[getColumnId(column)]} column={column} />
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
