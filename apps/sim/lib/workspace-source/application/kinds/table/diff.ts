/**
 * What applying a table declaration changes on its stored table: the table's own fields, and
 * per column an add, an update or a drop. Columns pair by the base's column binding when the
 * directory was read from this table, else by name; workflow-group output columns never pair and
 * are never dropped.
 */
import { db } from '@sim/db'
import type { BaseColumn, WorkspaceDiagnosticCode } from '@sim/workspace-code'
import {
  columnName,
  DEFAULT_CURRENCY_CODE,
  type TableColumnDecl,
  type TableDecl,
} from '@sim/workspace-code/kinds/table'
import { getColumnId } from '@/lib/table/column-keys'
import {
  countCellsLosingAnOption,
  countCellsLosingTheirOptions,
  countEmptyCells,
  countFilledCellsByColumn,
  countMultiValuedCells,
  getColumnRetypeScanBatchSize,
  isValueCompatibleWithColumn,
  readColumnRetypePage,
  selectValueForConversion,
} from '@/lib/table/columns/service'
import { normalizeSelectOptionsInput } from '@/lib/table/select-options'
import type { ColumnDefinition, ColumnType, SelectOption } from '@/lib/table/types'
import { finding } from '@/lib/workspace-source/application/findings'
import {
  type StoredTableState,
  sourceColumns,
} from '@/lib/workspace-source/application/kinds/table/stored'
import type { WorkspaceSourceDiagnostic } from '@/lib/workspace-source/application/types'

/**
 * Cells a type change reads, a page at a time, to tell whether they convert; past this, the
 * apply's own gate decides.
 */
const CONVERSION_SCAN_LIMIT = 50_000

/** The column change of one `op`. */
type ColumnOp<O extends ColumnChange['op']> = Extract<ColumnChange, { op: O }>

/** A type guard for the column changes of one `op`, for `find` and `filter`. */
export function isColumnOp<O extends ColumnChange['op']>(op: O) {
  return (change: ColumnChange): change is ColumnOp<O> => change.op === op
}

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

type ColumnChange =
  | { op: 'add'; key: string; column: ColumnInput }
  | { op: 'update'; columnId: string; updates: Partial<ColumnInput> }
  | { op: 'drop'; columnId: string; name: string; cells: number }

export interface TableChanges {
  table: { name?: string; description?: string | null; folderPath?: string }
  columns: ColumnChange[]
  /** Fields that change, for the plan display. */
  fields: string[]
  /** Cells a drop empties, and cells a removed option takes a selection from. */
  lostCells: number
  /** Select options removed (or renamed, which removes the old name) from stored columns. */
  removedOptions: number
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
  const bound = (key: string) =>
    bindings && Object.hasOwn(bindings, key) ? bindings[key] : undefined
  for (const key of keys) {
    const boundId = bound(key)?.id
    const column = boundId ? byId.get(boundId) : undefined
    if (column) {
      pairs.set(key, column)
      taken.add(getColumnId(column))
    }
  }
  for (const key of keys) {
    if (pairs.has(key) || bound(key)) continue
    const column = byName.get(columnName(key, decl.columns[key]).toLowerCase())
    if (column && !taken.has(getColumnId(column))) {
      pairs.set(key, column)
      taken.add(getColumnId(column))
    }
  }
  return pairs
}

/**
 * Cells of `current` (up to {@link CONVERSION_SCAN_LIMIT}) whose value does not convert to
 * `target`, read a page at a time so a column of large cells never sits in memory at once. As the
 * retype itself does, a `select` cell leaving `select` is judged by its option name(s), not its
 * stored id, and one that becomes empty counts only when the column ends up required.
 */
async function countIncompatibleCells(
  table: StoredTableState['table'],
  current: ColumnDefinition,
  target: ColumnDefinition
): Promise<number> {
  const columnId = getColumnId(current)
  const leavingSelect = current.type === 'select' && target.type !== 'select'
  const batch = getColumnRetypeScanBatchSize()
  let incompatible = 0
  let scanned = 0
  let afterId: string | undefined
  while (scanned < CONVERSION_SCAN_LIMIT) {
    const limit = Math.min(batch, CONVERSION_SCAN_LIMIT - scanned)
    const rows = await readColumnRetypePage(
      db,
      table.id,
      table.workspaceId,
      columnId,
      limit,
      afterId
    )
    for (const row of rows) {
      if (row.value === null || row.value === undefined) continue
      const value = leavingSelect ? selectValueForConversion(current, row.value) : row.value
      if (isValueCompatibleWithColumn(value, target)) continue
      if (value === null || value === '') {
        if (target.required) incompatible += 1
      } else incompatible += 1
    }
    scanned += rows.length
    afterId = rows.at(-1)?.id
    if (rows.length < limit) break
  }
  return incompatible
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/**
 * Plans the changes from `stored` to `decl`, counting what they lose: cells of a dropped column
 * and cells a removed select option takes a selection from. It refuses what the column write
 * would: empty cells of a newly required column, a required column's rows a removal empties,
 * rows a multi→single switch leaves with several options, and cells a type change cannot convert
 * (`E_TABLE_TYPE_CONVERSION`).
 */
export async function diffTable(
  key: string,
  decl: TableDecl,
  stored: StoredTableState,
  bindings: Readonly<Record<string, BaseColumn>> | undefined
): Promise<TableChanges> {
  const { table } = stored
  const diagnostics: WorkspaceSourceDiagnostic[] = []
  const report = (code: WorkspaceDiagnosticCode, message: string, hint: string) =>
    diagnostics.push(finding(code, message, { hint, kind: 'table', key }))
  const changes: TableChanges = {
    table: {},
    columns: [],
    fields: [],
    lostCells: 0,
    removedOptions: 0,
    diagnostics,
  }
  if (decl.name !== table.name) {
    changes.table.name = decl.name
    changes.fields.push('name')
  }
  if ((decl.description || null) !== (table.description || null)) {
    changes.table.description = decl.description || null
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
  const unpaired = columns.filter((column) => !paired.has(getColumnId(column)))
  const filled = await countFilledCellsByColumn(
    db,
    table.id,
    table.workspaceId,
    unpaired.map((column) => getColumnId(column))
  )
  for (const column of unpaired) {
    const cells = filled.get(getColumnId(column)) ?? 0
    changes.columns.push({
      op: 'drop',
      columnId: getColumnId(column),
      name: column.name,
      cells,
    })
    changes.fields.push(`columns.${column.name} (drop)`)
    changes.lostCells += cells
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
      const incompatible = await countIncompatibleCells(table, current, {
        ...target,
        id: columnId,
      })
      if (incompatible > 0) {
        report(
          'E_TABLE_TYPE_CONVERSION',
          `Column "${current.name}" cannot become ${target.type}: ${incompatible} cell(s) hold values that do not convert.`,
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
          report(
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
      // The options a removal in this change keeps, which a multi→single switch counts against.
      let kept: SelectOption[] | undefined
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
        const removed = existing.filter((option) => !names.includes(option.name)).length
        if (current.type === 'select' && removed > 0) {
          kept = options
          changes.removedOptions += removed
          const multiple = Boolean(current.multiple)
          changes.lostCells += await countCellsLosingAnOption(
            db,
            table.id,
            table.workspaceId,
            columnId,
            options,
            multiple
          )
          const stranded = target.required
            ? await countCellsLosingTheirOptions(
                db,
                table.id,
                table.workspaceId,
                columnId,
                options,
                multiple
              )
            : 0
          if (stranded > 0) {
            report(
              'E_APPLY_REFUSED',
              `Column "${current.name}" is required, and removing its options would leave ${stranded} row(s) empty.`,
              'Reassign those rows to a remaining option first.'
            )
          }
        }
      }
      if (Boolean(target.multiple) !== Boolean(current.multiple)) {
        updates.multiple = Boolean(target.multiple)
        fields.push('multiple')
        const multiValued =
          current.type === 'select' && current.multiple && !target.multiple
            ? await countMultiValuedCells(db, table.id, table.workspaceId, columnId, kept)
            : 0
        if (multiValued > 0) {
          report(
            'E_APPLY_REFUSED',
            `Column "${current.name}" cannot become single-select: ${multiValued} row(s) keep several options selected.`,
            'Reduce them to one option first.'
          )
        }
      }
    }
    if (
      target.type === 'currency' &&
      (target.currencyCode ?? DEFAULT_CURRENCY_CODE) !==
        (current.currencyCode ?? DEFAULT_CURRENCY_CODE)
    ) {
      updates.currencyCode = target.currencyCode ?? DEFAULT_CURRENCY_CODE
      fields.push('currencyCode')
    }
    if (fields.length === 0) continue
    changes.columns.push({ op: 'update', columnId, updates })
    changes.fields.push(...fields.map((field) => `columns.${columnKey}.${field}`))
  }

  const dropped = changes.columns.filter(isColumnOp('drop'))
  const added = changes.columns.filter(isColumnOp('add'))
  for (const drop of dropped) {
    const dropType = columns.find((column) => getColumnId(column) === drop.columnId)?.type
    const twin = added.find((add) => add.column.type === dropType)
    if (twin) {
      report(
        'W_LIKELY_RENAME',
        `Column "${drop.name}" is dropped and "${twin.key}" added with the same type, which loses ${drop.cells} cell(s).`,
        `To rename it and keep its cells, keep its key and set the new name: \`${drop.name}: column.${twin.column.type}({ name: '${twin.column.name}' })\`.`
      )
    }
  }
  return changes
}
