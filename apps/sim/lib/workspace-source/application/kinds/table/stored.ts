import { compareStrings } from '@sim/utils/string'
import { setOwn } from '@sim/workflow-code'
import {
  type BaseColumn,
  type BaseResource,
  fingerprintOf,
  type PrintedDeclaration,
  type ResourceFingerprint,
} from '@sim/workspace-code'
import {
  isDeclarableColumnKey,
  suffixedColumnKey,
  type TableColumnDecl,
  type TableDecl,
  tableCodec,
} from '@sim/workspace-code/kinds/table'
import { getColumnId } from '@/lib/table/column-keys'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'

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
interface TableAsDecl {
  decl: TableDecl
  /** Column id → source key. */
  keyById: Map<string, string>
  fingerprint: ResourceFingerprint
}

function columnDecl(column: ColumnDefinition, key: string): TableColumnDecl {
  const decl: TableColumnDecl = { type: column.type }
  if (column.name !== key) decl.name = column.name
  if (column.required) decl.required = true
  if (column.unique) decl.unique = true
  if (column.type === 'select') {
    decl.options = (column.options ?? []).map((option) => option.name)
    if (column.multiple) decl.multiple = true
  }
  if (column.type === 'currency' && column.currencyCode) decl.currencyCode = column.currencyCode
  return decl
}

/**
 * A stored table as the declaration it prints as. A column keeps the key `bindings` (the base's
 * column key → id) gives it; any other column is keyed by its name, so a fresh directory matches
 * columns by name.
 */
function tableAsDecl(
  state: StoredTableState,
  bindings?: Readonly<Record<string, BaseColumn>>
): TableAsDecl {
  const boundKey = new Map(Object.entries(bindings ?? {}).map(([key, column]) => [column.id, key]))
  const stored = sourceColumns(state.table)
  const keyById = new Map<string, string>()
  const taken = new Set<string>()
  // Bound keys first, so a column keyed by its name never takes a renamed column's key.
  for (const column of stored) {
    const key = boundKey.get(getColumnId(column))
    if (key === undefined || !isDeclarableColumnKey(key) || taken.has(key)) continue
    keyById.set(getColumnId(column), key)
    taken.add(key)
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
  const decl: TableDecl = {
    name: state.table.name,
    ...(state.table.description ? { description: state.table.description } : {}),
    ...(state.folderPath !== '/' ? { folder: state.folderPath } : {}),
    columns,
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

/** The base entry and printed files of a stored table read under `bindings`. */
export function printStoredTable(
  state: StoredTableState,
  key: string,
  bindings?: Readonly<Record<string, BaseColumn>>
): { base: BaseResource; printed: PrintedDeclaration } {
  const { decl, keyById, fingerprint } = tableAsDecl(state, bindings)
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
    base: { id: state.table.id, fingerprint, columns: sorted },
    printed: tableCodec.print(key, decl),
  }
}
