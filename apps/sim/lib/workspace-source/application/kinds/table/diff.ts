/**
 * What applying a table declaration changes on its stored table: the table's own fields, and
 * per column an add, an update or a drop. Columns pair by the base's column binding when the
 * directory was read from this table, else by name; workflow-group output columns never pair and
 * are never dropped.
 */
import { db } from '@sim/db'
import type { BaseColumn, WorkspaceDiagnosticCode } from '@sim/workspace-code'
import { columnName, type TableColumnDecl, type TableDecl } from '@sim/workspace-code/kinds/table'
import { getColumnId } from '@/lib/table/column-keys'
import { columnTypeById, columnTypeOf, type TypeSpecificColumnKey } from '@/lib/table/column-types'
import {
  countCellsLosingAnOption,
  countCellsLosingTheirOptions,
  countEmptyCells,
  countFilledCellsByColumn,
  countMultiValuedCells,
  getColumnRetypeScanBatchSize,
  hasDuplicateValues,
  isValueCompatibleWithColumn,
  readColumnRetypePage,
  retypeCellRewrite,
  selectValueForConversion,
} from '@/lib/table/columns/service'
import { normalizeSelectOptionsInput } from '@/lib/table/select-options'
import type { ColumnDefinition, ColumnType, RowData, SelectOption } from '@/lib/table/types'
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
  /** The `fields` that only add to what the table holds (a new column), which an adopt may write. */
  additions: string[]
  /** Stored columns this update renames, old name → new name. */
  renamedColumns: Array<{ from: string; to: string }>
  /** Every column name the table holds after the update, in declaration order. */
  columnNames: string[]
  /** Cells a drop empties, and cells a removed option takes a selection from. */
  lostCells: number
  /**
   * Select options removed from stored columns, by id: a rename that changes more than letter
   * case removes the old option.
   */
  removedOptions: number
  diagnostics: WorkspaceSourceDiagnostic[]
}

/** Whether a column's type owns `key`, as the column-type registry says. */
function owns(column: Pick<ColumnDefinition, 'type'>, key: TypeSpecificColumnKey): boolean {
  return columnTypeOf(column).ownedMetadata.includes(key)
}

/**
 * The add-column input for a declared column: the metadata its type owns, minting ids for select
 * options named in the declaration.
 */
export function columnInput(key: string, column: TableColumnDecl): ColumnInput {
  const input: ColumnInput = {
    name: columnName(key, column),
    // The codec admits only the registry's type ids, so this is the declared type.
    type: columnTypeById(column.type).id,
    ...(column.required ? { required: true } : {}),
    ...(column.unique ? { unique: true } : {}),
  }
  for (const owned of columnTypeById(column.type).ownedMetadata) {
    if (owned === 'options') input.options = normalizeSelectOptionsInput(column.options ?? []) ?? []
    else if (column[owned]) Object.assign(input, { [owned]: column[owned] })
  }
  return input
}

/**
 * A column's metadata as its type stamps it (`defaultMetadata`): what a column declared without a
 * currency code, say, ends up holding.
 */
function stampedMetadata(column: ColumnInput | ColumnDefinition): Partial<ColumnDefinition> {
  const shaped = { ...column, id: '' }
  return { ...shaped, ...columnTypeOf(column).defaultMetadata?.(shaped) }
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

/** What scanning a retype found: cells that do not convert, and whether converted values repeat. */
interface RetypeScan {
  incompatible: number
  duplicates: boolean
}

/**
 * How a converted cell compares for `unique`: by the text the column's equality reads (`->>`), so
 * a number and the string of its digits are one value, as the write's own scan sees them.
 */
function comparableText(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * Scans the cells of `current` (up to {@link CONVERSION_SCAN_LIMIT}) as the retype to `target`
 * would convert them, a page at a time so a column of large cells never sits in memory at once:
 * cells whose value does not convert, and, with `unique`, whether two converted values are equal
 * (`'1'` and `'01'` both become `1`), which no scan of the stored text sees. As the retype itself
 * does, a `select` cell leaving `select` is judged by its option name(s), not its stored id, and
 * one that becomes empty counts only when the column ends up required.
 */
async function scanRetype(
  table: StoredTableState['table'],
  current: ColumnDefinition,
  target: ColumnDefinition,
  unique: boolean
): Promise<RetypeScan> {
  const columnId = getColumnId(current)
  const leavingSelect =
    columnTypeOf(current).storesOpaqueIds && !columnTypeOf(target).storesOpaqueIds
  const batch = getColumnRetypeScanBatchSize()
  const seen = new Set<string>()
  const scan: RetypeScan = { incompatible: 0, duplicates: false }
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
      if (!isValueCompatibleWithColumn(value, target)) {
        if (value === null || value === '') {
          if (target.required) scan.incompatible += 1
        } else scan.incompatible += 1
        continue
      }
      if (!unique || scan.duplicates) continue
      const converted = retypeCellRewrite(value, target)
      const stored = converted ? converted.value : value
      if (stored === null || stored === '') continue
      const text = comparableText(stored)
      if (seen.has(text)) scan.duplicates = true
      else seen.add(text)
    }
    scanned += rows.length
    afterId = rows.at(-1)?.id
    if (rows.length < limit) break
  }
  return scan
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/** A rows-file cell that holds no value, as a required column counts it. */
function isEmptyCell(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

/**
 * Plans the changes from `stored` to `decl`, counting what they lose: cells of a dropped column
 * and cells a removed select option takes a selection from. It refuses what the column write
 * would: empty cells of a newly required column, a required column's rows a removal empties,
 * rows a multi→single switch leaves with several options, and cells a type change cannot convert
 * (`E_TABLE_TYPE_CONVERSION`). `unkeyedRows` is set only when the apply writes managed rows: the stored
 * rows (cells by column id) that write leaves as they are, so declared rows that fill a column
 * stand for every other row.
 */
export async function diffTable(
  key: string,
  decl: TableDecl,
  stored: StoredTableState,
  bindings: Readonly<Record<string, BaseColumn>> | undefined,
  unkeyedRows?: readonly RowData[]
): Promise<TableChanges> {
  const { table } = stored
  const diagnostics: WorkspaceSourceDiagnostic[] = []
  const report = (code: WorkspaceDiagnosticCode, message: string, hint: string) =>
    diagnostics.push(finding(code, message, { hint, kind: 'table', key }))
  const changes: TableChanges = {
    table: {},
    columns: [],
    fields: [],
    additions: [],
    renamedColumns: [],
    columnNames: Object.entries(decl.columns).map(([columnKey, column]) =>
      columnName(columnKey, column)
    ),
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
    // A managed rows write makes every keyed row hold exactly a declared one, so when each fills
    // the column and so does every row the write keeps, every row does: the reshape writes the
    // rows before it makes the column required. Rows this apply writes nothing to prove nothing.
    const filled =
      unkeyedRows !== undefined &&
      decl.rows?.mode === 'managed' &&
      decl.rows.data.every((row) => !isEmptyCell(row[columnKey])) &&
      unkeyedRows.every((row) => current !== undefined && !isEmptyCell(row[getColumnId(current)]))
    if (!current) {
      const label = `columns.${columnKey} (add)`
      changes.columns.push({ op: 'add', key: columnKey, column: target })
      changes.fields.push(label)
      changes.additions.push(label)
      // A new column is empty in every row, so a required one would hold rows that break it,
      // unless managed rows fill it.
      if (target.required && table.rowCount > 0 && !filled) {
        report(
          'E_APPLY_REFUSED',
          `Column "${target.name}" cannot be added as required: the table's ${table.rowCount} row(s) would have no value.`,
          'Add it without `required`, fill its cells, then make it required.'
        )
      }
      continue
    }
    const columnId = getColumnId(current)
    const updates: Partial<ColumnInput> = {}
    const fields: string[] = []
    if (target.name !== current.name) {
      updates.name = target.name
      fields.push('name')
      changes.renamedColumns.push({ from: current.name, to: target.name })
    }
    const retyped = target.type !== current.type
    const becomesUnique = Boolean(target.unique) && !current.unique
    if (retyped) {
      updates.type = target.type
      fields.push('type')
      const scan = await scanRetype(table, current, { ...target, id: columnId }, becomesUnique)
      if (scan.incompatible > 0) {
        report(
          'E_TABLE_TYPE_CONVERSION',
          `Column "${current.name}" cannot become ${target.type}: ${scan.incompatible} cell(s) hold values that do not convert.`,
          'Fix or clear those cells first, or add a new column instead.'
        )
      } else if (scan.duplicates) {
        report(
          'E_APPLY_REFUSED',
          `Column "${current.name}" cannot become a unique ${target.type}: two or more rows hold values that are equal once converted.`,
          'Make those values distinct first, or change the type without `unique` and add it later.'
        )
      }
    }
    if (Boolean(target.required) !== Boolean(current.required)) {
      updates.required = Boolean(target.required)
      fields.push('required')
      if (target.required && !filled) {
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
      // A retype's converted values were checked by its scan above.
      if (
        becomesUnique &&
        !retyped &&
        (await hasDuplicateValues(db, table.id, table.workspaceId, current))
      ) {
        report(
          'E_APPLY_REFUSED',
          `Column "${current.name}" cannot become unique: two or more rows share a value.`,
          'Make those values distinct first.'
        )
      }
    }
    // The options a removal in this change keeps, which a multi→single switch counts against.
    let kept: SelectOption[] | undefined
    if (owns(target, 'options')) {
      const names = declared.options ?? []
      const existing = owns(current, 'options') ? (current.options ?? []) : []
      if (
        !sameList(
          names,
          existing.map((option) => option.name)
        )
      ) {
        const options = normalizeSelectOptionsInput(names, existing) ?? []
        updates.options = options
        fields.push('options')
        // By id, as the column write removes them: a letter-case rename keeps its option.
        const keptIds = new Set(options.map((option) => option.id))
        const removed = existing.filter((option) => !keptIds.has(option.id)).length
        if (owns(current, 'options') && removed > 0) {
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
    }
    if (owns(target, 'multiple') && Boolean(target.multiple) !== Boolean(current.multiple)) {
      updates.multiple = Boolean(target.multiple)
      fields.push('multiple')
      const multiValued =
        owns(current, 'multiple') && current.multiple && !target.multiple
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
    // Any other owned metadata is a plain value: compared as each side's type stamps it, so a
    // currency column declared without a code matches one stored in the default code.
    const stamped = stampedMetadata(target)
    const before = stampedMetadata({ ...current, type: target.type })
    for (const owned of columnTypeById(target.type).ownedMetadata) {
      if (owned === 'options' || owned === 'multiple') continue
      if (stamped[owned] === before[owned]) continue
      updates[owned] = stamped[owned]
      fields.push(owned)
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
