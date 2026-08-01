import { TABLE_LIMITS } from '@/lib/table/constants'
import { TableQueryValidationError } from '@/lib/table/errors'
import { encodeCursor } from '@/lib/table/rows/cursor'
import type { TableScope } from '@/lib/table/service'
import type { QueryOptions, QueryResult, TableDefinition, TableRow } from '@/lib/table/types'
import { getMemoryTableId, isMemoryTableId } from '@/lib/virtual-tables/memory-virtual-table'
import {
  findMemoryTableRowMatches,
  getMemoryTableById,
  getMemoryTableDefinition,
  queryMemoryTableRows,
} from '@/lib/virtual-tables/memory-virtual-table.server'

interface VirtualTablePage {
  rows: TableRow[]
  totalCount: number | null
  keysetValid: boolean
  hasMore?: boolean
}

interface VirtualTable {
  getId(workspaceId: string): string
  matchesId(tableId: string): boolean
  getTableById(tableId: string): Promise<TableDefinition | null>
  getTable(workspaceId: string): Promise<TableDefinition | null>
  queryRows(table: TableDefinition, options: QueryOptions): Promise<VirtualTablePage>
  findRowMatches(
    table: TableDefinition,
    options: Pick<QueryOptions, 'filter' | 'sort'> & { q: string }
  ): Promise<{
    matches: Array<{ ordinal: number; rowId: string; column: string }>
    truncated: boolean
  }>
}

const VIRTUAL_TABLES: VirtualTable[] = [
  {
    getId: getMemoryTableId,
    matchesId: isMemoryTableId,
    getTableById: getMemoryTableById,
    getTable: getMemoryTableDefinition,
    queryRows: (table, options) =>
      queryMemoryTableRows({ workspaceId: table.workspaceId, ...options }),
    findRowMatches: (table, options) =>
      findMemoryTableRowMatches({ workspaceId: table.workspaceId, ...options }),
  },
]

export async function getVirtualTableById(tableId: string): Promise<TableDefinition | null> {
  const virtualTable = VIRTUAL_TABLES.find((candidate) => candidate.matchesId(tableId))
  if (!virtualTable) return null
  return virtualTable.getTableById(tableId)
}

export async function listVirtualTables(
  workspaceId: string,
  options: { scope?: TableScope } = {}
): Promise<TableDefinition[]> {
  const { scope = 'active' } = options
  if (scope === 'archived') return []
  const tables = await Promise.all(
    VIRTUAL_TABLES.map((virtualTable) => virtualTable.getTable(workspaceId))
  )
  return tables.filter((table): table is TableDefinition => table !== null)
}

export async function queryVirtualTableRows(
  table: TableDefinition,
  options: QueryOptions
): Promise<QueryResult> {
  const virtualTable = VIRTUAL_TABLES.find(
    (candidate) => candidate.getId(table.workspaceId) === table.id
  )
  if (!virtualTable) throw new TableQueryValidationError('Virtual table not found')
  const limit = options.limit ?? TABLE_LIMITS.DEFAULT_QUERY_LIMIT
  const offset = options.offset ?? 0
  const page = await virtualTable.queryRows(table, {
    ...options,
    limit: limit + 1,
    offset,
  })
  const hasMore = page.hasMore === true || page.rows.length > limit
  const rows = page.rows.slice(0, limit)
  const lastRow = rows[rows.length - 1]

  return {
    rows,
    rowCount: rows.length,
    totalCount: page.totalCount,
    limit,
    offset,
    nextCursor:
      hasMore && lastRow
        ? encodeCursor({
            lastRow,
            keysetValid: page.keysetValid,
            nextOffset: offset + rows.length,
            sort: options.sort,
          })
        : null,
  }
}

export async function findVirtualTableRowMatches(
  table: TableDefinition,
  options: Pick<QueryOptions, 'filter' | 'sort'> & { q: string }
): Promise<{
  matches: Array<{ ordinal: number; rowId: string; column: string }>
  truncated: boolean
}> {
  const virtualTable = VIRTUAL_TABLES.find(
    (candidate) => candidate.getId(table.workspaceId) === table.id
  )
  if (!virtualTable) throw new TableQueryValidationError('Virtual table not found')
  return virtualTable.findRowMatches(table, options)
}
