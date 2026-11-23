/**
 * A table's rows as workspace source (`tables/<key>.rows.jsonl`): reading the stored rows through
 * the row listing use case as the cells a rows file holds, and building the rows a reshape writes.
 * Rows are written only by `reshapeTableUseCase`, which writes only the rows that differ, so a
 * managed table's columns, rows and managed marker commit together.
 */
import type { Json } from '@sim/workflow-code'
import type { BaseRows } from '@sim/workspace-code'
import {
  hasRowKey,
  printedRowBytes,
  type TableRowCells,
  type TableRowsDecl,
  tableRowsFingerprint,
} from '@sim/workspace-code/kinds/table-rows'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { listTableRows } from '@/lib/table/application/rows'
import { getColumnId } from '@/lib/table/column-keys'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { readCurrentRowsVersion } from '@/lib/table/row-changes'
import { selectValueToNames } from '@/lib/table/select-values'
import type { ColumnDefinition, RowData, TableDefinition } from '@/lib/table/types'
import type { SourceContext } from '@/lib/workspace-source/application/types'

/**
 * A managed table holds more rows, or more printed row bytes, than one directory's rows files may:
 * a get skips the table, and a write already committed keeps the rows file the directory sent.
 */
export class StoredRowsOverLimitError extends OrchestrationError {}

/** A stored table's rows as source reads them. */
export interface StoredRows {
  /** Each row's source cells, keyed by column key. */
  data: TableRowCells[]
  /** Each row's stored cells, keyed by column id, in the order of `data`. */
  byColumnId: RowData[]
  /** The table's row version when the rows were read. */
  version: number
}

/**
 * The stored rows (cells by column id) whose `rowKey` cell is empty: rows source does not manage,
 * which no rows write changes or removes.
 */
export function unkeyedRows(rows: StoredRows, rowKey: string): RowData[] {
  return rows.byColumnId.filter((_, index) => !hasRowKey(rows.data[index], rowKey))
}

/** The table's live row version, refusing a table that left the workspace. */
export async function rowsVersion(ctx: SourceContext, tableId: string): Promise<number> {
  const version = await readCurrentRowsVersion(tableId, ctx.workspace.workspaceId)
  if (version === null) throw new OrchestrationError('not_found', 'The table no longer exists.')
  return version
}

/** A stored cell as a rows file holds it: a select cell by option names. */
function sourceCell(column: ColumnDefinition, value: unknown): Json {
  return column.type === 'select' ? selectValueToNames(column, value) : (value as Json)
}

/**
 * Reads every row of `table`: the cells of each column `keyById` names (column id → column key).
 * The version is read first, so rows written while the listing pages read as a server change on
 * the next apply. The rows a rows file prints (those holding `rowKey`) are counted as each one
 * is read, and the read stops at the row that takes them past `maxRowsBytes`, which no directory
 * could hold ({@link StoredRowsOverLimitError}, as for a table past `maxTableRows`).
 */
export async function readStoredRows(
  ctx: SourceContext,
  table: TableDefinition,
  keyById: ReadonlyMap<string, string>,
  rowKey: string
): Promise<StoredRows> {
  if (table.rowCount > WORKSPACE_SOURCE_LIMITS.maxTableRows) {
    throw new StoredRowsOverLimitError(
      'validation',
      `Table "${table.name}" holds ${table.rowCount} rows; source manages at most ${WORKSPACE_SOURCE_LIMITS.maxTableRows}.`
    )
  }
  const version = await rowsVersion(ctx, table.id)
  const columnsById = new Map(table.schema.columns.map((column) => [getColumnId(column), column]))
  const data: TableRowCells[] = []
  const byColumnId: RowData[] = []
  let printedBytes = 0
  let cursor: string | undefined
  do {
    const page = await listTableRows.execute({
      principal: ctx.principal,
      input: {
        tableId: table.id,
        assertedWorkspaceId: ctx.workspace.workspaceId,
        limit: TABLE_LIMITS.MAX_QUERY_LIMIT,
        ...(cursor ? { cursor } : {}),
      },
    })
    for (const row of page.rows) {
      const cells: TableRowCells = {}
      for (const [columnId, value] of Object.entries(row.data)) {
        const column = columnsById.get(columnId)
        const key = keyById.get(columnId)
        if (column && key !== undefined) cells[key] = sourceCell(column, value)
      }
      if (hasRowKey(cells, rowKey)) printedBytes += printedRowBytes(cells)
      if (printedBytes > WORKSPACE_SOURCE_LIMITS.maxRowsBytes) {
        throw new StoredRowsOverLimitError(
          'payload_too_large',
          `The rows of table "${table.name}" pass the ${WORKSPACE_SOURCE_LIMITS.maxRowsBytes}-byte limit a directory's rows files hold.`
        )
      }
      data.push(cells)
      byColumnId.push(row.data)
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return { data, byColumnId, version }
}

/** The base entry of managed rows read or written as `rows`. */
export function baseRows(rows: TableRowsDecl, version: number): BaseRows | undefined {
  const fingerprint = tableRowsFingerprint(rows)
  return fingerprint ? { fingerprint, version } : undefined
}

/** Declared rows keyed by stored column name, as a reshape writes them. */
export function namedRows(rows: TableRowsDecl, nameByKey: ReadonlyMap<string, string>): RowData[] {
  return rows.data.map((row) => {
    const named: RowData = {}
    for (const [key, value] of Object.entries(row)) {
      const name = nameByKey.get(key)
      if (name !== undefined && value !== null) named[name] = value
    }
    return named
  })
}
