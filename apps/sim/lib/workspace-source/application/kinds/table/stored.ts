import { compareStrings } from '@sim/utils/string'
import {
  type BaseColumn,
  type BaseResource,
  fingerprintOf,
  type PrintedDeclaration,
  type ResourceFingerprint,
} from '@sim/workspace-code'
import { type TableColumnDecl, type TableDecl, tableCodec } from '@sim/workspace-code/kinds/table'
import { getColumnId } from '@/lib/table/column-keys'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'
import type { StoredResource } from '@/lib/workspace-source/application/types'

/** A stored table as source sees it: the definition and its folder path (`/` at the root). */
export interface StoredTableState {
  table: TableDefinition
  folderPath: string
}

export type StoredTable = StoredResource<StoredTableState>

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
export function tableAsDecl(
  state: StoredTableState,
  bindings?: Readonly<Record<string, BaseColumn>>
): TableAsDecl {
  const boundKey = new Map(Object.entries(bindings ?? {}).map(([key, column]) => [column.id, key]))
  const columns: Record<string, TableColumnDecl> = {}
  const keyById = new Map<string, string>()
  for (const column of sourceColumns(state.table)) {
    const id = getColumnId(column)
    let key = boundKey.get(id) ?? column.name
    for (let suffix = 2; Object.hasOwn(columns, key); suffix += 1) key = `${column.name}_${suffix}`
    columns[key] = columnDecl(column, key)
    keyById.set(id, key)
  }
  const decl: TableDecl = {
    name: state.table.name,
    ...(state.table.description ? { description: state.table.description } : {}),
    ...(state.folderPath !== '/' ? { folder: state.folderPath } : {}),
    columns,
  }
  return { decl, keyById, fingerprint: fingerprintOf(tableCodec.canonical(decl)) }
}

/** The base entry and printed files of a stored table read under `bindings`. */
export function printStoredTable(
  stored: StoredTable,
  key: string,
  bindings?: Readonly<Record<string, BaseColumn>>
): { base: BaseResource; printed: PrintedDeclaration; fingerprint: ResourceFingerprint } {
  const { decl, keyById, fingerprint } = tableAsDecl(stored.state, bindings)
  const columns: Record<string, BaseColumn> = {}
  for (const column of sourceColumns(stored.state.table)) {
    const columnKey = keyById.get(getColumnId(column))
    if (columnKey === undefined) continue
    columns[columnKey] = {
      id: getColumnId(column),
      ...(column.options && column.options.length > 0
        ? { options: Object.fromEntries(column.options.map((option) => [option.name, option.id])) }
        : {}),
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(columns).sort(([a], [b]) => compareStrings(a, b))
  )
  return {
    base: { id: stored.id, fingerprint, columns: sorted },
    printed: tableCodec.print(key, decl),
    fingerprint,
  }
}
