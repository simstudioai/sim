/**
 * What applying a table declaration changes on its stored table: the table's own fields, and
 * per column an add, an update or a drop. Columns pair by the base's column binding when the
 * directory was read from this table, else by name; workflow-group output columns never pair and
 * are never dropped.
 */
import { db } from '@sim/db'
import type { BaseColumn } from '@sim/workspace-code'
import { columnName, type TableColumnDecl, type TableDecl } from '@sim/workspace-code/kinds/table'
import { getColumnId } from '@/lib/table/column-keys'
import {
  countCellsLosingTheirOptions,
  countEmptyCells,
  countFilledCells,
  isValueCompatibleWithColumn,
  readColumnValues,
} from '@/lib/table/columns/service'
import { normalizeSelectOptionsInput } from '@/lib/table/select-options'
import type { ColumnDefinition, ColumnType, SelectOption } from '@/lib/table/types'
import { type StoredTableState, sourceColumns } from '@/lib/workspace-source/kinds/table/stored'
import type { WorkspaceSourceDiagnostic } from '@/lib/workspace-source/types'

/** Cells a type change reads to tell whether they convert; past this, the apply's own gate decides. */
const CONVERSION_SCAN_LIMIT = 50_000

/** A column as the add and update use cases take it. */
export interface ColumnInput {
  name: string
  type: ColumnType
  required?: boolean
  unique?: boolean
  options?: SelectOption[]
  multiple?: boolean
  currencyCode?: string
}

export type ColumnChange =
  | { op: 'add'; key: string; column: ColumnInput }
  | { op: 'update'; key: string; columnId: string; updates: Partial<ColumnInput>; fields: string[] }
  | { op: 'drop'; key: string; columnId: string; name: string; cells: number }

export interface TableChanges {
  table: { name?: string; description?: string | null; folderPath?: string }
  columns: ColumnChange[]
  /** Fields that change, for the plan display. */
  fields: string[]
  /** Cells a drop or a removed option loses. */
  lostCells: number
  dropped: number
  diagnostics: WorkspaceSourceDiagnostic[]
}

/** The add-column input for a declared column, minting option ids. */
export function columnInput(key: string, column: TableColumnDecl): ColumnInput {
  return {
    name: columnName(key, column),
    type: column.type,
    ...(column.required ? { required: true } : {}),
    ...(column.unique ? { unique: true } : {}),
    ...(column.type === 'select'
      ? {
          options: normalizeSelectOptionsInput(column.options ?? []) ?? [],
          ...(column.multiple ? { multiple: true } : {}),
        }
      : {}),
    ...(column.type === 'currency' && column.currencyCode
      ? { currencyCode: column.currencyCode }
      : {}),
  }
}

/** Pairs each declared column with the stored column it updates, if any. */
function pairColumns(
  decl: TableDecl,
  stored: ColumnDefinition[],
  bindings: Readonly<Record<string, BaseColumn>> | undefined
): Map<string, ColumnDefinition> {
  const byId = new Map(stored.map((column) => [getColumnId(column), column]))
  const byName = new Map(stored.map((column) => [column.name.toLowerCase(), column]))
  const taken = new Set<string>()
  const pairs = new Map<string, ColumnDefinition>()
  const keys = Object.keys(decl.columns)
  for (const key of keys) {
    const boundId = bindings?.[key]?.id
    const column = boundId ? byId.get(boundId) : undefined
    if (column) {
      pairs.set(key, column)
      taken.add(getColumnId(column))
    }
  }
  for (const key of keys) {
    if (pairs.has(key) || bindings?.[key]) continue
    const column = byName.get(columnName(key, decl.columns[key]).toLowerCase())
    if (column && !taken.has(getColumnId(column))) {
      pairs.set(key, column)
      taken.add(getColumnId(column))
    }
  }
  return pairs
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/**
 * Plans the changes from `stored` to `decl`, counting what they lose: cells of a dropped column,
 * cells a removed select option empties, empty cells a newly required column refuses, and cells a
 * type change cannot convert (`E_TABLE_TYPE_CONVERSION`).
 */
export async function diffTable(
  key: string,
  decl: TableDecl,
  stored: StoredTableState,
  bindings: Readonly<Record<string, BaseColumn>> | undefined
): Promise<TableChanges> {
  const { table } = stored
  const diagnostics: WorkspaceSourceDiagnostic[] = []
  const refuse = (code: string, message: string, hint?: string) =>
    diagnostics.push({
      code,
      severity: 'error',
      message,
      ...(hint ? { hint } : {}),
      kind: 'table',
      key,
    })
  const changes: TableChanges = {
    table: {},
    columns: [],
    fields: [],
    lostCells: 0,
    dropped: 0,
    diagnostics,
  }
  if (decl.name !== table.name) {
    changes.table.name = decl.name
    changes.fields.push('name')
  }
  if ((decl.description ?? null) !== (table.description || null)) {
    changes.table.description = decl.description ?? null
    changes.fields.push('description')
  }
  const folder = decl.folder ?? '/'
  if (folder !== stored.folderPath) {
    changes.table.folderPath = folder
    changes.fields.push('folder')
  }

  const columns = sourceColumns(table)
  const pairs = pairColumns(decl, columns, bindings)
  const paired = new Set([...pairs.values()].map((column) => getColumnId(column)))
  const count = (columnId: string) => countFilledCells(db, table.id, table.workspaceId, columnId)

  for (const column of columns) {
    if (paired.has(getColumnId(column))) continue
    const cells = await count(getColumnId(column))
    changes.columns.push({
      op: 'drop',
      key: column.name,
      columnId: getColumnId(column),
      name: column.name,
      cells,
    })
    changes.fields.push(`columns.${column.name} (drop)`)
    changes.lostCells += cells
    changes.dropped += 1
  }

  for (const [columnKey, declared] of Object.entries(decl.columns)) {
    const current = pairs.get(columnKey)
    const target = columnInput(columnKey, declared)
    if (!current) {
      changes.columns.push({ op: 'add', key: columnKey, column: target })
      changes.fields.push(`columns.${columnKey} (add)`)
      continue
    }
    const columnId = getColumnId(current)
    const updates: Partial<ColumnInput> = {}
    const fields: string[] = []
    if (target.name !== current.name) {
      updates.name = target.name
      fields.push('name')
    }
    if (target.type !== current.type) {
      updates.type = target.type
      fields.push('type')
      const values = await readColumnValues(
        db,
        table.id,
        table.workspaceId,
        columnId,
        CONVERSION_SCAN_LIMIT
      )
      const definition: ColumnDefinition = { ...target, id: columnId }
      const incompatible = values.filter((value) => !isValueCompatibleWithColumn(value, definition))
      if (incompatible.length > 0) {
        refuse(
          'E_TABLE_TYPE_CONVERSION',
          `Column "${current.name}" cannot become ${target.type}: ${incompatible.length} cell(s) hold values that do not convert.`,
          'Fix or clear those cells first, or add a new column instead.'
        )
      }
    }
    if (Boolean(target.required) !== Boolean(current.required)) {
      updates.required = Boolean(target.required)
      fields.push('required')
      if (target.required) {
        const empty = await countEmptyCells(db, table.id, table.workspaceId, columnId)
        if (empty > 0) {
          refuse(
            'E_APPLY_REFUSED',
            `Column "${current.name}" cannot become required: ${empty} row(s) have no value.`,
            'Fill those cells first.'
          )
        }
      }
    }
    if (Boolean(target.unique) !== Boolean(current.unique)) {
      updates.unique = Boolean(target.unique)
      fields.push('unique')
    }
    if (target.type === 'select') {
      const names = declared.options ?? []
      const existing = current.type === 'select' ? (current.options ?? []) : []
      if (
        !sameList(
          names,
          existing.map((option) => option.name)
        )
      ) {
        const options = normalizeSelectOptionsInput(names, existing) ?? []
        updates.options = options
        fields.push('options')
        if (current.type === 'select' && existing.some((option) => !names.includes(option.name))) {
          const lost = await countCellsLosingTheirOptions(
            db,
            table.id,
            table.workspaceId,
            columnId,
            options,
            Boolean(current.multiple)
          )
          changes.lostCells += lost
        }
      }
      if (Boolean(target.multiple) !== Boolean(current.multiple)) {
        updates.multiple = Boolean(target.multiple)
        fields.push('multiple')
      }
    }
    if (
      target.type === 'currency' &&
      (target.currencyCode ?? null) !== (current.currencyCode ?? null)
    ) {
      if (target.currencyCode) updates.currencyCode = target.currencyCode
      fields.push('currencyCode')
    }
    if (fields.length === 0) continue
    changes.columns.push({ op: 'update', key: columnKey, columnId, updates, fields })
    changes.fields.push(...fields.map((field) => `columns.${columnKey}.${field}`))
  }

  const dropped = changes.columns.filter((change) => change.op === 'drop')
  const added = changes.columns.filter((change) => change.op === 'add')
  for (const drop of dropped) {
    const dropType = columns.find((column) => getColumnId(column) === drop.columnId)?.type
    const twin = added.find((add) => add.op === 'add' && add.column.type === dropType)
    if (twin && twin.op === 'add') {
      diagnostics.push({
        code: 'W_LIKELY_RENAME',
        severity: 'warning',
        message: `Column "${drop.name}" is dropped and "${twin.key}" added with the same type, which loses ${drop.cells} cell(s).`,
        hint: `To rename it and keep its cells, keep its key and set the new name: \`${drop.name}: column.${twin.column.type}({ name: '${twin.column.name}' })\`.`,
        kind: 'table',
        key,
      })
    }
  }
  return changes
}
