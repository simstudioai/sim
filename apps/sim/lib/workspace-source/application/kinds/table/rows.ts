/**
 * A table's rows as workspace source (`tables/<key>.rows.jsonl`): reading the stored rows through
 * the row listing use case as the cells a rows file holds, and building the rows a reshape writes.
 * Rows are written only by `reshapeTableUseCase`, which writes only the rows that differ, so a
 * managed table's columns, rows and managed marker commit together.
 */
import type { Json } from '@sim/workflow-code'
import type { BaseRows } from '@sim/workspace-code'
import {
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

/** A stored table's rows as source reads them. */
export interface StoredRows {
  /** Each row's source cells, keyed by column key. */
  data: TableRowCells[]
  /** The table's row version when the rows were read. */
  version: number
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
 * the next apply.
 */
export async function readStoredRows(
  ctx: SourceContext,
  table: TableDefinition,
  keyById: ReadonlyMap<string, string>
): Promise<StoredRows> {
  if (table.rowCount > WORKSPACE_SOURCE_LIMITS.maxTableRows) {
    throw new OrchestrationError(
      'validation',
      `Table "${table.name}" holds ${table.rowCount} rows; source manages at most ${WORKSPACE_SOURCE_LIMITS.maxTableRows}.`
    )
  }
  const version = await rowsVersion(ctx, table.id)
  const columnsById = new Map(table.schema.columns.map((column) => [getColumnId(column), column]))
  const data: TableRowCells[] = []
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
      data.push(cells)
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return { data, version }
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
