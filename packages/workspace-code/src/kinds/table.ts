/**
 * Tables: `tables/<key>.ts` declares one table's name, description, folder and columns, and opts
 * into rows as source with `rows` (`tables/<key>.rows.jsonl`, see `./table-rows`). A column's object key is its stable source key, bound to the stored
 * column id in the base; `name` sets the stored column name when it differs from the key, so a
 * rename keeps the column and its cells.
 *
 * ```ts
 * export default defineTable({
 *   name: 'leads',
 *   columns: {
 *     email: column.string({ required: true, unique: true }),
 *     status: column.select({ options: ['new', 'won'] }),
 *   },
 * })
 * ```
 *
 * The column types are not listed here: the server builds a {@link TableColumnCatalog} from its
 * column-type registry and makes the codec with {@link createTableCodec}, so the types, what
 * metadata each owns, which may be unique and how many one table holds all come from the registry.
 */

import { isSupportedCurrencyCode } from '@sim/table-cells/currency'
import { type BatchRowErrors, coerceRowCells, refusedRows } from '@sim/table-cells/rows'
import type { CellColumn, CellRow } from '@sim/table-cells/types'
import type { Json } from '@sim/workflow-code'
import {
  asDeclared,
  booleanField,
  canonicalFields,
  type DeclField,
  type DeclFields,
  folderField,
  printFields,
  readFields,
  stringField,
} from '../declaration/field-table'
import {
  checkKnownFields,
  type FieldReport,
  fieldPointer,
  fieldReporter,
  isOneOf,
  readBooleanField,
  readObject,
  readStringField,
} from '../declaration/fields'
import { call, printDeclaration } from '../declaration/print'
import { isDeclarationCall, readDeclaration } from '../declaration/read'
import { diagnostic, resourceOf, type WorkspaceDiagnostic, wholeFile } from '../diagnostics'
import { KIND_DIRS, type KindCodec, type KindLayout } from '../kind'
import { DECLARATION_EXTENSION } from '../layout'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'
import { groupByFile } from './group'
import {
  parseTableRows,
  printTableRows,
  rowKeyText,
  TABLE_ROWS_EXTENSION,
  TABLE_ROWS_MODES,
  type TableRowCells,
  type TableRowsDecl,
  tableRowsPath,
} from './table-rows'

/**
 * The type-specific column options a column type can own (`TYPE_SPECIFIC_COLUMN_KEYS` on the
 * server): the catalog names which ones each type owns, and this codec knows how to read each.
 */
export const TABLE_COLUMN_METADATA_KEYS = ['options', 'multiple', 'currencyCode'] as const

type TableColumnMetadataKey = (typeof TABLE_COLUMN_METADATA_KEYS)[number]

/** One column type as the server's column-type registry describes it. */
export interface TableColumnTypeDescriptor {
  /**
   * The type-specific options a column of this type owns. A column prints them in
   * `TABLE_COLUMN_METADATA_KEYS` order, whatever their order here.
   */
  owns: readonly TableColumnMetadataKey[]
  /** Whether a column of this type may be unique. */
  unique: boolean
  /** The most columns of this type one table holds; absent when unlimited. */
  maxPerTable?: number
  /** The owned values the server stamps on a column declared without them (a currency code). */
  defaults?: Partial<Record<TableColumnMetadataKey, string | boolean>>
}

/** The column types a declaration may use, keyed by type id, and the limits on their options. */
export interface TableColumnCatalog {
  types: Readonly<Record<string, TableColumnTypeDescriptor>>
  /** The most options one column holds. */
  maxOptions: number
}

/** One column as `column.<type>()` declares it. */
export interface TableColumnDecl {
  /** A type id of the catalog the codec was made with. */
  type: string
  /** The stored column name, when it differs from the column's key. */
  name?: string
  required?: boolean
  unique?: boolean
  /** The option names of a type that owns `options`, in display order. */
  options?: string[]
  /** A type that owns `multiple`: several options per cell. */
  multiple?: boolean
  /** A type that owns `currencyCode`: its ISO 4217 code. */
  currencyCode?: string
}

/** A table as `tables/<key>.ts` declares it. */
export interface TableDecl {
  name: string
  description?: string
  /** The table folder path (`/reports`); the workspace root when absent. */
  folder?: string
  columns: Record<string, TableColumnDecl>
  /** Rows as source: absent leaves the table's rows out of source. */
  rows?: TableRowsDecl
}

/**
 * Table and column name and description rules. Mirrors `NAME_PATTERN` and `TABLE_LIMITS`
 * (apps/sim/lib/table/constants), which an apps/sim test holds this equal to.
 */
export const TABLE_TEXT_RULES = {
  namePattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
  maxTableName: 128,
  maxColumnName: 50,
  maxDescription: 500,
} as const
const CALLEE = 'defineTable'

/**
 * The options every column type takes; the catalog adds the type-specific ones
 * ({@link TABLE_COLUMN_METADATA_KEYS}). Required and unique are off by default, so the fingerprint
 * spells them out and `required: false` and its absence agree. A column's `name` is fingerprinted
 * as the stored name it resolves to ({@link columnName}), which needs its key.
 */
const COLUMN_FIELDS: DeclFields<Omit<TableColumnDecl, 'type' | TableColumnMetadataKey>> = {
  name: { ...stringField(), canonical: null },
  required: booleanField((required) => required === true),
  unique: booleanField((unique) => unique === true),
}

/**
 * Whether a stored column's name can key it in a declaration: the declaration reader refuses a
 * `__proto__` key, so such a column prints under another key with its `name` set.
 */
export function isDeclarableColumnKey(name: string): boolean {
  return name !== '__proto__'
}

/**
 * The key a stored column prints under when its name is taken: `name_<suffix>`, with the name
 * shortened so the key stays within the column-name limit the reader enforces.
 */
export function suffixedColumnKey(name: string, suffix: number): string {
  const tail = `_${suffix}`
  return `${name.slice(0, TABLE_TEXT_RULES.maxColumnName - tail.length)}${tail}`
}

/** The declaration file of table `key`. */
function tablePath(key: string): string {
  return `${KIND_DIRS.table}/${key}${DECLARATION_EXTENSION}`
}

/** The stored name of a declared column. */
export function columnName(key: string, column: TableColumnDecl): string {
  return column.name ?? key
}

/** A declared column as the cell rules read it, keyed by its column key; select options by name. */
function cellColumn(key: string, column: TableColumnDecl): CellColumn {
  return {
    id: key,
    name: columnName(key, column),
    type: column.type,
    ...(column.required ? { required: true } : {}),
    ...(column.unique ? { unique: true } : {}),
    ...(column.options ? { options: column.options.map((name) => ({ id: name, name })) } : {}),
    ...(column.multiple ? { multiple: true } : {}),
    ...(column.currencyCode ? { currencyCode: column.currencyCode } : {}),
  }
}

/**
 * The declared rows of `decl` a write refuses (`refusedRows`, by row index): a cell its column's
 * type or options cannot hold, an empty required cell, a unique value two rows share. Rows are
 * keyed by column key, as `tables/<key>.rows.jsonl` holds them, and are not changed; a select
 * cell is checked against the option names. The server refuses a dry run on these, and the CLI's
 * offline check reports each at its line. `sizeErrors` refuses a row over the server's size limit.
 */
export function refusedTableRows(
  decl: TableDecl,
  rows: readonly TableRowCells[],
  sizeErrors?: (row: CellRow) => string[]
): BatchRowErrors {
  const columns = Object.entries(decl.columns).map(([key, column]) => cellColumn(key, column))
  return refusedRows(
    rows.map((row) => ({ ...row })),
    columns,
    sizeErrors
  )
}

/**
 * The text a declared managed row of `decl` is matched by ({@link rowKeyText}): its key cell
 * coerced to the key column's type first, as a keyed write stores it, so `"007"` in a number key
 * column matches the stored `7`. A value the column cannot hold is matched as written.
 */
export function declaredRowKeyText(decl: TableDecl, row: TableRowCells): string | undefined {
  const key = decl.rows?.key
  const column = key !== undefined ? decl.columns[key] : undefined
  if (key === undefined || !column || !Object.hasOwn(row, key)) return undefined
  const cell: CellRow = { [key]: row[key] }
  coerceRowCells(cell, [cellColumn(key, column)], () => 'reject')
  return rowKeyText(cell[key])
}

/** Reads one owned option of a column into `column`, reporting a value the server would refuse. */
type MetadataReader = (
  column: TableColumnDecl,
  key: string,
  options: Record<string, Json>,
  pointer: string,
  report: FieldReport,
  catalog: TableColumnCatalog
) => void

const METADATA_READERS: Record<TableColumnMetadataKey, MetadataReader> = {
  options(column, key, options, pointer, report, catalog) {
    const raw = options.options
    const at = fieldPointer(pointer, 'options')
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      !raw.every((item) => typeof item === 'string' && item.length > 0)
    ) {
      report(
        'E_TABLE_OPTIONS',
        raw === undefined ? pointer : at,
        `Column "${key}" needs \`options\`: a non-empty list of names.`
      )
      return
    }
    const names = raw as string[]
    if (names.length > catalog.maxOptions) {
      report(
        'E_TABLE_OPTIONS',
        at,
        `Column "${key}" lists ${names.length} options; a column holds at most ${catalog.maxOptions}.`
      )
      return
    }
    // The server folds letter case when it checks option names for repeats.
    const folded = new Set<string>()
    const duplicate = names.find((item) => {
      const name = item.toLowerCase()
      if (folded.has(name)) return true
      folded.add(name)
      return false
    })
    if (duplicate !== undefined)
      report('E_TABLE_OPTIONS', at, `Option "${duplicate}" is listed twice.`)
    column.options = [...names]
  },
  multiple(column, _key, options, pointer, report) {
    const multiple = readBooleanField(options, 'multiple', pointer, report)
    if (multiple !== undefined) column.multiple = multiple
  },
  currencyCode(column, _key, options, pointer, report) {
    const code = readStringField(options, 'currencyCode', pointer, report)
    if (code === undefined) return
    // Upper-cased as the server stores it, so `usd` reads as the `USD` a get prints.
    if (isSupportedCurrencyCode(code)) column.currencyCode = code.toUpperCase()
    else
      report(
        'E_DECL_SHAPE',
        fieldPointer(pointer, 'currencyCode'),
        `"${code}" is not a supported currency code; use a three-letter ISO 4217 code such as \`USD\`.`
      )
  },
}

function readColumn(
  key: string,
  value: Json,
  pointer: string,
  report: FieldReport,
  catalog: TableColumnCatalog
): TableColumnDecl | undefined {
  const type = isDeclarationCall(value) ? value.$call.slice('column.'.length) : ''
  const descriptor = Object.hasOwn(catalog.types, type) ? catalog.types[type] : undefined
  if (!isDeclarationCall(value) || !descriptor) {
    report(
      'E_DECL_SHAPE',
      pointer,
      `Column "${key}" must be a column helper call.`,
      `For example \`${key}: column.string()\`.`
    )
    return undefined
  }
  if (value.args.length > 1) {
    report('E_DECL_SHAPE', pointer, `column.${type}() takes at most one options object.`)
    return undefined
  }
  const optionsPointer = `${pointer}/args/0`
  const options =
    value.args.length === 0
      ? {}
      : readObject(value.args[0], optionsPointer, report, `column.${type}() options`)
  if (!options) return undefined
  const column: TableColumnDecl = {
    type,
    ...readFields(COLUMN_FIELDS, options, optionsPointer, report, descriptor.owns),
  }
  if (column.unique && !descriptor.unique) {
    report(
      'E_DECL_SHAPE',
      fieldPointer(optionsPointer, 'unique'),
      `A ${type} column cannot be unique.`,
      'Drop `unique`, or use a string column for values that must not repeat.'
    )
  }
  for (const owned of descriptor.owns) {
    METADATA_READERS[owned](column, key, options, optionsPointer, report, catalog)
  }
  return column
}

function checkColumnName(name: string, pointer: string, report: FieldReport): void {
  if (!TABLE_TEXT_RULES.namePattern.test(name) || name.length > TABLE_TEXT_RULES.maxColumnName) {
    report(
      'E_TABLE_COLUMN_NAME',
      pointer,
      `"${name}" is not a valid column name.`,
      `A column name starts with a letter or \`_\`, holds letters, digits and \`_\`, and is at most ${TABLE_TEXT_RULES.maxColumnName} characters.`
    )
  }
}

function parseTable(
  key: string,
  text: Readonly<Record<string, string>>,
  fields: DeclFields<TableDecl>,
  calls: ReadonlySet<string>
): { decl?: TableDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = tablePath(key)
  const source = text[file] ?? ''
  const read = readDeclaration(file, source, { callee: CALLEE, calls })
  const resource = resourceOf('table', key)
  const diagnostics: WorkspaceDiagnostic[] = read.diagnostics.map((finding) => ({
    ...finding,
    ...resource,
  }))
  if (read.value === undefined) return { diagnostics }
  const report = fieldReporter(source, read.spans, diagnostics, resource)
  const value = readObject(read.value, '', report, `${CALLEE}()`)
  if (!value) return { diagnostics }
  const { name, columns, rows, ...rest } = readFields(fields, value, '', report)
  const rowsFile = tableRowsPath(key)
  const rowsText = text[rowsFile]
  if (rowsText !== undefined && rows === undefined) {
    diagnostics.push(
      diagnostic(
        'E_TABLE_ROWS',
        `${rowsFile} is not part of source: ${file} declares no \`rows\`.`,
        {
          ...resource,
          span: wholeFile(rowsFile),
          hint: "Add `rows: { mode: 'managed', key: '<column>' }` (or `{ mode: 'seed' }`), or delete the file.",
        }
      )
    )
  }
  if (rows && columns) checkRowsKey(rows, columns, report)
  if (
    diagnostics.some((finding) => finding.severity === 'error') ||
    name === undefined ||
    columns === undefined
  ) {
    return { diagnostics }
  }
  if (!rows) return { decl: { name, ...rest, columns }, diagnostics }
  const parsed = parseTableRows(key, rowsText ?? '', rows, new Set(Object.keys(columns)))
  diagnostics.push(...parsed.diagnostics)
  if (parsed.diagnostics.some((finding) => finding.severity === 'error')) return { diagnostics }
  return { decl: { name, ...rest, columns, rows: { ...rows, data: parsed.data } }, diagnostics }
}

/** A managed table's `key` names a declared unique column; a seed table names none. */
function checkRowsKey(
  rows: TableRowsDecl,
  columns: Readonly<Record<string, TableColumnDecl>>,
  report: FieldReport
): void {
  const at = fieldPointer('', 'rows')
  if (rows.mode === 'seed') {
    if (rows.key !== undefined)
      report(
        'E_TABLE_ROWS',
        fieldPointer(at, 'key'),
        'Seed rows take no `key`.',
        "Drop `key`, or use `mode: 'managed'`."
      )
    return
  }
  if (rows.key === undefined) {
    report('E_TABLE_ROWS', at, 'Managed rows need `key`: the unique column each row is matched by.')
    return
  }
  const column = Object.hasOwn(columns, rows.key) ? columns[rows.key] : undefined
  if (!column?.unique) {
    report(
      'E_TABLE_ROWS',
      fieldPointer(at, 'key'),
      column
        ? `Column "${rows.key}" is not unique, so it cannot match managed rows.`
        : `"${rows.key}" is not a declared column.`,
      'Name a column declared `unique: true`.'
    )
  }
}

/** A table's `rows`: its mode and key; the rows themselves come from the rows file. */
const rowsField: DeclField<TableRowsDecl | undefined> = {
  read(value, field, pointer, report) {
    if (value[field] === undefined) return undefined
    const at = fieldPointer(pointer, field)
    const rows = readObject(value[field], at, report, field)
    if (!rows) return undefined
    checkKnownFields(rows, ['mode', 'key'], at, report)
    const mode = readStringField(rows, 'mode', at, report, { required: true })
    if (mode === undefined) return undefined
    if (!isOneOf(TABLE_ROWS_MODES, mode)) {
      report(
        'E_TABLE_ROWS',
        fieldPointer(at, 'mode'),
        `"${mode}" is not a rows mode.`,
        "Use 'seed' or 'managed'."
      )
      return undefined
    }
    const key = readStringField(rows, 'key', at, report)
    return { mode, ...(key !== undefined ? { key } : {}), data: [] }
  },
  print: (rows) =>
    rows === undefined
      ? undefined
      : { mode: rows.mode, ...(rows.key !== undefined ? { key: rows.key } : {}) },
  // Seed rows are written once, so only managed rows are part of the table's identity; their
  // content is fingerprinted apart (`tableRowsFingerprint`).
  canonical: (rows) =>
    rows?.mode === 'managed' ? { mode: rows.mode, key: rows.key ?? null } : undefined,
}

/** Reads `columns`: each column, then the checks across them (shared names, per-type limits). */
function readColumns(
  value: Record<string, Json>,
  pointer: string,
  report: FieldReport,
  catalog: TableColumnCatalog
): Record<string, TableColumnDecl> | undefined {
  const at = fieldPointer(pointer, 'columns')
  if (value.columns === undefined) {
    report('E_DECL_SHAPE', pointer, '"columns" is required.')
    return undefined
  }
  const rawColumns = readObject(value.columns, at, report, 'columns')
  if (!rawColumns) return undefined
  const columns: Record<string, TableColumnDecl> = {}
  const entries = Object.entries(rawColumns)
  if (entries.length === 0) report('E_DECL_SHAPE', at, 'A table needs at least one column.')
  if (entries.length > WORKSPACE_SOURCE_LIMITS.maxColumns) {
    report(
      'E_TABLE_TOO_MANY_COLUMNS',
      at,
      `A table holds at most ${WORKSPACE_SOURCE_LIMITS.maxColumns} columns.`
    )
  }
  const seen = new Map<string, string>()
  for (const [columnKey, raw] of entries) {
    const columnPointer = fieldPointer(at, columnKey)
    checkColumnName(columnKey, columnPointer, report)
    const column = readColumn(columnKey, raw, columnPointer, report, catalog)
    if (!column) continue
    const stored = columnName(columnKey, column)
    if (column.name !== undefined)
      checkColumnName(column.name, `${columnPointer}/args/0/name`, report)
    const folded = stored.toLowerCase()
    const previous = seen.get(folded)
    if (previous !== undefined) {
      report(
        'E_TABLE_DUPLICATE_COLUMN',
        columnPointer,
        `Columns "${previous}" and "${columnKey}" share the name "${stored}".`
      )
    }
    seen.set(folded, columnKey)
    columns[columnKey] = column
  }
  for (const [type, { maxPerTable: max }] of Object.entries(catalog.types)) {
    const keys = Object.keys(columns).filter((columnKey) => columns[columnKey].type === type)
    if (max === undefined || keys.length <= max) continue
    report(
      'E_DECL_SHAPE',
      fieldPointer(at, keys[max]),
      `A table holds at most ${max} ${type} column(s); ${keys.join(', ')} are all ${type}.`
    )
  }
  return columns
}

/** A table's `name`: required, within the length limit, and a valid table name. */
const tableNameField: DeclField<string | undefined> = {
  read(value, field, pointer, report) {
    const name = readStringField(value, field, pointer, report, {
      required: true,
      maxLength: TABLE_TEXT_RULES.maxTableName,
    })
    if (name !== undefined && !TABLE_TEXT_RULES.namePattern.test(name)) {
      report(
        'E_DECL_SHAPE',
        fieldPointer(pointer, field),
        `"${name}" is not a valid table name.`,
        'A table name starts with a letter or `_` and holds letters, digits and `_`.'
      )
    }
    return name
  },
  print: asDeclared,
  canonical: asDeclared,
}

function printColumn(column: TableColumnDecl): Json {
  const options = printFields(COLUMN_FIELDS, column)
  for (const key of TABLE_COLUMN_METADATA_KEYS) {
    const value = column[key]
    if (value !== undefined) options[key] = value
  }
  return Object.keys(options).length === 0
    ? call(`column.${column.type}`)
    : call(`column.${column.type}`, options)
}

/** The value an owned option takes when a declaration leaves it out. */
const ABSENT: Record<TableColumnMetadataKey, Json> = {
  options: [],
  multiple: false,
  currencyCode: null,
}

/**
 * Where tables live: one `tables/<key>.ts` each, beside its optional `tables/<key>.rows.jsonl`, all
 * text, whatever the column catalog. Rows count against their own budget.
 */
export const tableLayout: KindLayout = {
  group: (paths) =>
    groupByFile(KIND_DIRS.table, [DECLARATION_EXTENSION, TABLE_ROWS_EXTENSION], paths),
  budgetOf: (path) => (path.endsWith(TABLE_ROWS_EXTENSION) ? 'rows' : 'declaration'),
}

/**
 * Makes the codec of `tables/<key>.ts` for the column types of `catalog`. The canonical column
 * spells out defaults, so `required: false` and its absence agree, and an owned option the
 * declaration leaves out takes the value the server stamps.
 */
export function createTableCodec(catalog: TableColumnCatalog): KindCodec<TableDecl> {
  const calls = new Set(Object.keys(catalog.types).map((type) => `column.${type}`))
  const canonicalColumn = (key: string, column: TableColumnDecl): Json => {
    const descriptor = Object.hasOwn(catalog.types, column.type)
      ? catalog.types[column.type]
      : undefined
    const canonical: Record<string, Json> = {
      type: column.type,
      ...canonicalFields(COLUMN_FIELDS, column),
      name: columnName(key, column),
    }
    for (const owned of descriptor?.owns ?? []) {
      canonical[owned] = column[owned] ?? descriptor?.defaults?.[owned] ?? ABSENT[owned]
    }
    return canonical
  }
  const columnsField: DeclField<Record<string, TableColumnDecl> | undefined> = {
    read: (value, _field, pointer, report) => readColumns(value, pointer, report, catalog),
    print: (columns = {}) =>
      Object.fromEntries(
        Object.entries(columns).map(([key, column]) => [key, printColumn(column)])
      ),
    canonical: (columns = {}) =>
      Object.fromEntries(
        Object.entries(columns).map(([key, column]) => [key, canonicalColumn(key, column)])
      ),
  }
  const fields: DeclFields<TableDecl> = {
    name: tableNameField,
    description: stringField(
      { maxLength: TABLE_TEXT_RULES.maxDescription },
      (description) => description || null
    ),
    folder: folderField('/reports'),
    columns: columnsField,
    rows: rowsField,
  }
  return {
    ...tableLayout,
    parse: (key, text) => parseTable(key, text, fields, calls),
    print: (key, decl) => {
      const rows = decl.rows && printTableRows(decl.rows, Object.keys(decl.columns))
      return {
        text: {
          [tablePath(key)]: printDeclaration(CALLEE, printFields(fields, decl)),
          ...(rows !== undefined ? { [tableRowsPath(key)]: rows } : {}),
        },
        blobs: [],
      }
    },
    canonical: (decl) => canonicalFields(fields, decl),
  }
}
