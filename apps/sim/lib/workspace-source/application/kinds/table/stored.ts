import { compareStrings } from '@sim/utils/string'
import { setOwn } from '@sim/workflow-code'
import {
  type BaseColumn,
  type BaseResource,
  type BaseRows,
  fingerprintOf,
  type PrintedDeclaration,
  type ResourceFingerprint,
} from '@sim/workspace-code'
import {
  isDeclarableColumnKey,
  suffixedColumnKey,
  type TableColumnDecl,
  type TableDecl,
} from '@sim/workspace-code/kinds/table'
import type { TableRowCells, TableRowsDecl } from '@sim/workspace-code/kinds/table-rows'
import { getColumnId } from '@/lib/table/column-keys'
import { columnTypeOf } from '@/lib/table/column-types'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'
import { tableCodec } from '@/lib/workspace-source/application/kinds/table/codec'
import { baseRows } from '@/lib/workspace-source/application/kinds/table/rows'

/** A stored table as source sees it: the definition and its folder path (`/` at the root). */
export interface StoredTableState {
  table: TableDefinition
  folderPath: string
}

/** Source columns only: a workflow group's output columns belong to their group. */
export function sourceColumns(table: TableDefinition): ColumnDefinition[] {
  return table.schema.columns.filter((column) => !column.workflowGroupId)
}

/** A stored table read as a declaration, with the column key each stored column printed under. */
export interface TableAsDecl {
  decl: TableDecl
  /** Column id → source key. */
  keyById: Map<string, string>
  fingerprint: ResourceFingerprint
}

/** A stored column as declared: the metadata its type owns, select options by name. */
function columnDecl(column: ColumnDefinition, key: string): TableColumnDecl {
  const decl: TableColumnDecl = { type: column.type }
  if (column.name !== key) decl.name = column.name
  if (column.required) decl.required = true
  if (column.unique) decl.unique = true
  for (const owned of columnTypeOf(column).ownedMetadata) {
    if (owned === 'options') decl.options = (column.options ?? []).map((option) => option.name)
    else if (column[owned]) Object.assign(decl, { [owned]: column[owned] })
  }
  return decl
}

/**
 * A stored table as the declaration it prints as. A column keeps the key `bindings` (the base's
 * column key → id) gives it, else the key the last source write recorded for it
 * (`metadata.sourceColumnKeys`), so a fresh directory and another workspace's read print the key
 * the declaration gave it; any other column is keyed by its name.
 */
export function tableAsDecl(
  state: StoredTableState,
  bindings?: Readonly<Record<string, BaseColumn>>
): TableAsDecl {
  const boundKey = new Map(Object.entries(bindings ?? {}).map(([key, column]) => [column.id, key]))
  const recordedKey = state.table.metadata?.sourceColumnKeys ?? {}
  const stored = sourceColumns(state.table)
  const keyById = new Map<string, string>()
  const taken = new Set<string>()
  // Bound keys first, then recorded ones, so a column keyed by its name never takes a renamed
  // column's key.
  for (const keyOf of [
    (id: string) => boundKey.get(id),
    (id: string) => (Object.hasOwn(recordedKey, id) ? recordedKey[id] : undefined),
  ]) {
    for (const column of stored) {
      const id = getColumnId(column)
      const key = keyOf(id)
      if (keyById.has(id) || key === undefined || !isDeclarableColumnKey(key) || taken.has(key)) {
        continue
      }
      keyById.set(id, key)
      taken.add(key)
    }
  }
  for (const column of stored) {
    const id = getColumnId(column)
    if (keyById.has(id)) continue
    let key = column.name
    for (let suffix = 2; !isDeclarableColumnKey(key) || taken.has(key); suffix += 1) {
      key = suffixedColumnKey(column.name, suffix)
    }
    keyById.set(id, key)
    taken.add(key)
  }
  const columns: Record<string, TableColumnDecl> = {}
  for (const column of stored) {
    const key = keyById.get(getColumnId(column)) ?? column.name
    setOwn(columns, key, columnDecl(column, key))
  }
  // Rows source manages print as `rows`, keyed by the column the marker names while it exists;
  // seed rows print as their `rows` alone, since the directory keeps their file.
  const marker = state.table.metadata?.sourceRows
  const rowsKey = marker?.mode === 'managed' ? keyById.get(marker.keyColumnId) : undefined
  const decl: TableDecl = {
    name: state.table.name,
    ...(state.table.description ? { description: state.table.description } : {}),
    ...(state.folderPath !== '/' ? { folder: state.folderPath } : {}),
    columns,
    ...(rowsKey !== undefined
      ? { rows: { mode: 'managed', key: rowsKey, data: [] } }
      : marker?.mode === 'seed'
        ? { rows: { mode: 'seed', data: [] } }
        : {}),
  }
  return { decl, keyById, fingerprint: fingerprintOf(tableCodec.canonical(decl)) }
}

/**
 * The fingerprint a plan compares with a base entry's: the declaration's, marked when a column the
 * base binds is gone. A column replaced by a same-named, same-shaped one prints the same
 * declaration, so without the mark a plan would read the table unchanged and drop the
 * replacement's cells as an undeclared column.
 */
export function storedFingerprint(
  state: StoredTableState,
  bindings?: Readonly<Record<string, BaseColumn>>
): ResourceFingerprint {
  const { fingerprint } = tableAsDecl(state, bindings)
  const ids = new Set(sourceColumns(state.table).map((column) => getColumnId(column)))
  const unbound = Object.entries(bindings ?? {})
    .filter(([, column]) => !ids.has(column.id))
    .map(([key]) => key)
    .sort(compareStrings)
  return unbound.length === 0 ? fingerprint : fingerprintOf({ fingerprint, unbound })
}

/**
 * The base entry and printed files of a stored table read under `bindings`. `rows` carries the
 * rows to print: a managed table's rows with the row version they were read at (without one, the
 * base records no rows entry), or the seed rows a declaration wrote, which the server keeps no
 * record of.
 */
export function printStoredTable(
  state: StoredTableState,
  key: string,
  bindings?: Readonly<Record<string, BaseColumn>>,
  rows?: { data: TableRowCells[]; version?: number } | { seed: TableRowsDecl }
): { base: BaseResource; printed: PrintedDeclaration } {
  const { decl, keyById, fingerprint } = tableAsDecl(state, bindings)
  let rowsEntry: BaseRows | undefined
  if (rows && 'seed' in rows) {
    if (decl.rows?.mode !== 'managed') decl.rows = rows.seed
  } else if (decl.rows && rows) {
    decl.rows = { ...decl.rows, data: rows.data }
    if (rows.version !== undefined) rowsEntry = baseRows(decl.rows, rows.version)
  }
  const columns: Record<string, BaseColumn> = {}
  for (const column of sourceColumns(state.table)) {
    const columnKey = keyById.get(getColumnId(column))
    if (columnKey === undefined) continue
    setOwn(columns, columnKey, {
      id: getColumnId(column),
      ...(column.options && column.options.length > 0
        ? { options: Object.fromEntries(column.options.map((option) => [option.name, option.id])) }
        : {}),
    })
  }
  const sorted = Object.fromEntries(
    Object.entries(columns).sort(([a], [b]) => compareStrings(a, b))
  )
  return {
    base: {
      id: state.table.id,
      fingerprint,
      columns: sorted,
      ...(rowsEntry ? { rows: rowsEntry } : {}),
    },
    printed: tableCodec.print(key, decl),
  }
}
