/**
 * Tables: `tables/<key>.ts` declares one table's name, description, folder and columns. Rows are
 * never part of source. A column's object key is its stable source key, bound to the stored
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
import type { Json } from '@sim/workflow-code'
import {
  checkKnownFields,
  type FieldReport,
  fieldPointer,
  fieldReporter,
  readBooleanField,
  readFolderField,
  readObject,
  readStringField,
} from '../declaration/fields'
import { call, printDeclaration } from '../declaration/print'
import { isDeclarationCall, readDeclaration } from '../declaration/read'
import type { WorkspaceDiagnostic } from '../diagnostics'
import { KIND_DIRS, type KindCodec, type KindLayout } from '../kind'
import { DECLARATION_EXTENSION } from '../layout'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'
import { groupByFile } from './group'

/**
 * The type-specific column options a column type can own (`TYPE_SPECIFIC_COLUMN_KEYS` on the
 * server): the catalog names which ones each type owns, and this codec knows how to read each.
 */
export const TABLE_COLUMN_METADATA_KEYS = ['options', 'multiple', 'currencyCode'] as const

type TableColumnMetadataKey = (typeof TABLE_COLUMN_METADATA_KEYS)[number]

/** One column type as the server's column-type registry describes it. */
export interface TableColumnTypeDescriptor {
  /** The type-specific options a column of this type owns, in print order. */
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
}

/** Table and column names (`NAME_PATTERN` in apps/sim/lib/table/constants). */
const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_TABLE_NAME_LENGTH = 128
const MAX_COLUMN_NAME_LENGTH = 50
const MAX_DESCRIPTION_LENGTH = 500
const CURRENCY_CODE = /^[A-Za-z]{3}$/

/**
 * Whether `code` is an ISO 4217 code this runtime knows, in any letter case, as the server's
 * currency column checks it (`isSupportedCurrencyCode`); a runtime that cannot list currencies
 * checks the shape alone.
 */
function isSupportedCurrencyCode(code: string): boolean {
  if (!CURRENCY_CODE.test(code)) return false
  try {
    return Intl.supportedValuesOf('currency').includes(code.toUpperCase())
  } catch {
    return true
  }
}

const CALLEE = 'defineTable'
const TABLE_FIELDS = ['name', 'description', 'folder', 'columns']
const COLUMN_FIELDS = ['name', 'required', 'unique']

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
  return `${name.slice(0, MAX_COLUMN_NAME_LENGTH - tail.length)}${tail}`
}

/** The declaration file of table `key`. */
function tablePath(key: string): string {
  return `${KIND_DIRS.table}/${key}${DECLARATION_EXTENSION}`
}

/** The stored name of a declared column. */
export function columnName(key: string, column: TableColumnDecl): string {
  return column.name ?? key
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
    // The server folds letter case when it checks option names for repeats.
    const folded = names.map((item) => item.toLowerCase())
    const duplicate = names.find((_, index) => folded.indexOf(folded[index]) !== index)
    if (duplicate !== undefined)
      report('E_TABLE_OPTIONS', at, `Option "${duplicate}" is listed twice.`)
    if (names.length > catalog.maxOptions)
      report(
        'E_TABLE_OPTIONS',
        at,
        `Column "${key}" lists ${names.length} options; a column holds at most ${catalog.maxOptions}.`
      )
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
  const column: TableColumnDecl = { type }
  const optionsPointer = `${pointer}/args/0`
  const options =
    value.args.length === 0
      ? {}
      : readObject(value.args[0], optionsPointer, report, `column.${type}() options`)
  if (!options) return undefined
  checkKnownFields(options, [...COLUMN_FIELDS, ...descriptor.owns], optionsPointer, report)
  const name = readStringField(options, 'name', optionsPointer, report)
  if (name !== undefined) column.name = name
  const required = readBooleanField(options, 'required', optionsPointer, report)
  if (required !== undefined) column.required = required
  const unique = readBooleanField(options, 'unique', optionsPointer, report)
  if (unique !== undefined) column.unique = unique
  if (unique && !descriptor.unique) {
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
  if (!TABLE_NAME_PATTERN.test(name) || name.length > MAX_COLUMN_NAME_LENGTH) {
    report(
      'E_TABLE_COLUMN_NAME',
      pointer,
      `"${name}" is not a valid column name.`,
      `A column name starts with a letter or \`_\`, holds letters, digits and \`_\`, and is at most ${MAX_COLUMN_NAME_LENGTH} characters.`
    )
  }
}

function parseTable(
  key: string,
  text: Readonly<Record<string, string>>,
  catalog: TableColumnCatalog,
  calls: ReadonlySet<string>
): { decl?: TableDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = tablePath(key)
  const source = text[file] ?? ''
  const read = readDeclaration(file, source, { callee: CALLEE, calls })
  const diagnostics = read.diagnostics.map((finding) => ({ ...finding, kind: 'table', key }))
  if (read.value === undefined) return { diagnostics }
  const report = fieldReporter(source, read.spans, diagnostics, { kind: 'table', key })
  const value = readObject(read.value, '', report, `${CALLEE}()`)
  if (!value) return { diagnostics }
  checkKnownFields(value, TABLE_FIELDS, '', report)
  const name = readStringField(value, 'name', '', report, {
    required: true,
    maxLength: MAX_TABLE_NAME_LENGTH,
  })
  if (name !== undefined && !TABLE_NAME_PATTERN.test(name)) {
    report(
      'E_DECL_SHAPE',
      '/name',
      `"${name}" is not a valid table name.`,
      'A table name starts with a letter or `_` and holds letters, digits and `_`.'
    )
  }
  const description = readStringField(value, 'description', '', report, {
    maxLength: MAX_DESCRIPTION_LENGTH,
  })
  const folder = readFolderField(value, report, '/reports')
  const columns: Record<string, TableColumnDecl> = {}
  const rawColumns =
    value.columns === undefined
      ? undefined
      : readObject(value.columns, '/columns', report, 'columns')
  if (value.columns === undefined) report('E_DECL_SHAPE', '', '"columns" is required.')
  if (rawColumns) {
    const entries = Object.entries(rawColumns)
    if (entries.length === 0)
      report('E_DECL_SHAPE', '/columns', 'A table needs at least one column.')
    if (entries.length > WORKSPACE_SOURCE_LIMITS.maxColumns) {
      report(
        'E_TABLE_TOO_MANY_COLUMNS',
        '/columns',
        `A table holds at most ${WORKSPACE_SOURCE_LIMITS.maxColumns} columns.`
      )
    }
    const seen = new Map<string, string>()
    for (const [columnKey, raw] of entries) {
      const pointer = fieldPointer('/columns', columnKey)
      checkColumnName(columnKey, pointer, report)
      const column = readColumn(columnKey, raw, pointer, report, catalog)
      if (!column) continue
      const stored = columnName(columnKey, column)
      if (column.name !== undefined) checkColumnName(column.name, `${pointer}/args/0/name`, report)
      const folded = stored.toLowerCase()
      const previous = seen.get(folded)
      if (previous !== undefined) {
        report(
          'E_TABLE_DUPLICATE_COLUMN',
          pointer,
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
        fieldPointer('/columns', keys[max]),
        `A table holds at most ${max} ${type} column(s); ${keys.join(', ')} are all ${type}.`
      )
    }
  }
  if (diagnostics.some((finding) => finding.severity === 'error') || name === undefined) {
    return { diagnostics }
  }
  return {
    decl: {
      name,
      ...(description !== undefined ? { description } : {}),
      ...(folder !== undefined ? { folder } : {}),
      columns,
    },
    diagnostics,
  }
}

function printColumn(column: TableColumnDecl): Json {
  const options: Record<string, Json> = {}
  if (column.name !== undefined) options.name = column.name
  if (column.required !== undefined) options.required = column.required
  if (column.unique !== undefined) options.unique = column.unique
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

/** Where tables live: one `tables/<key>.ts` each, all text, whatever the column catalog. */
export const tableLayout: KindLayout = {
  group: (paths) => groupByFile(KIND_DIRS.table, [DECLARATION_EXTENSION], paths),
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
      name: columnName(key, column),
      required: column.required === true,
      unique: column.unique === true,
    }
    for (const owned of descriptor?.owns ?? []) {
      canonical[owned] = column[owned] ?? descriptor?.defaults?.[owned] ?? ABSENT[owned]
    }
    return canonical
  }
  return {
    ...tableLayout,
    parse: (key, text) => parseTable(key, text, catalog, calls),
    print(key, decl) {
      const value: Record<string, Json> = { name: decl.name }
      if (decl.description !== undefined) value.description = decl.description
      if (decl.folder !== undefined) value.folder = decl.folder
      value.columns = Object.fromEntries(
        Object.entries(decl.columns).map(([columnKey, column]) => [columnKey, printColumn(column)])
      )
      return {
        text: {
          [tablePath(key)]: printDeclaration(CALLEE, value),
        },
        blobs: [],
      }
    },
    canonical: (decl) => ({
      name: decl.name,
      description: decl.description || null,
      folder: decl.folder ?? '/',
      columns: Object.fromEntries(
        Object.entries(decl.columns).map(([key, column]) => [key, canonicalColumn(key, column)])
      ),
    }),
  }
}
