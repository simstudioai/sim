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
 */
import type { Json } from '@sim/workflow-code'
import {
  checkKnownFields,
  type FieldReport,
  fieldPointer,
  fieldReporter,
  readBooleanField,
  readObject,
  readStringField,
} from '../declaration/fields'
import { call, printDeclaration } from '../declaration/print'
import { isDeclarationCall, readDeclaration } from '../declaration/read'
import type { WorkspaceDiagnostic } from '../diagnostics'
import { KIND_DIRS, type KindCodec } from '../kind'
import { DECLARATION_EXTENSION } from '../layout'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'
import { groupByFile } from './group'

/** Column types, as `apps/sim/lib/table/column-types` defines them. */
const TABLE_COLUMN_TYPES = [
  'string',
  'number',
  'currency',
  'boolean',
  'date',
  'ttl',
  'json',
  'select',
] as const

type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number]

/** The code the server stamps on a `currency` column declared without one. */
export const DEFAULT_CURRENCY_CODE = 'USD'

export interface TableColumnDecl {
  type: TableColumnType
  /** The stored column name, when it differs from the column's key. */
  name?: string
  required?: boolean
  unique?: boolean
  /** A `select` column's option names, in display order. */
  options?: string[]
  /** A `select` column that holds several options per cell. */
  multiple?: boolean
  /** A `currency` column's ISO 4217 code. */
  currencyCode?: string
}

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
const CURRENCY_CODE = /^[A-Z]{3}$/

const CALLEE = 'defineTable'
const TABLE_FIELDS = ['name', 'description', 'folder', 'columns']
const COLUMN_FIELDS = ['name', 'required', 'unique']
const TYPE_FIELDS: Partial<Record<TableColumnType, readonly string[]>> = {
  select: ['options', 'multiple'],
  currency: ['currencyCode'],
}
const COLUMN_CALLS = new Set(TABLE_COLUMN_TYPES.map((type) => `column.${type}`))

/** The stored name of a declared column. */
export function columnName(key: string, column: TableColumnDecl): string {
  return column.name ?? key
}

function isColumnType(value: string): value is TableColumnType {
  return (TABLE_COLUMN_TYPES as readonly string[]).includes(value)
}

function readColumn(
  key: string,
  value: Json,
  pointer: string,
  report: FieldReport
): TableColumnDecl | undefined {
  const type = isDeclarationCall(value) ? value.$call.slice('column.'.length) : ''
  if (!isDeclarationCall(value) || !isColumnType(type)) {
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
  checkKnownFields(
    options,
    [...COLUMN_FIELDS, ...(TYPE_FIELDS[type] ?? [])],
    optionsPointer,
    report
  )
  const name = readStringField(options, 'name', optionsPointer, report)
  if (name !== undefined) column.name = name
  const required = readBooleanField(options, 'required', optionsPointer, report)
  if (required !== undefined) column.required = required
  const unique = readBooleanField(options, 'unique', optionsPointer, report)
  if (unique !== undefined) column.unique = unique
  if (type === 'select') {
    const raw = options.options
    const at = fieldPointer(optionsPointer, 'options')
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      !raw.every((item) => typeof item === 'string' && item.length > 0)
    ) {
      report(
        'E_TABLE_OPTIONS',
        raw === undefined ? optionsPointer : at,
        `Select column "${key}" needs \`options\`: a non-empty list of names.`
      )
    } else {
      const names = raw as string[]
      const duplicate = names.find((item, index) => names.indexOf(item) !== index)
      if (duplicate !== undefined)
        report('E_TABLE_OPTIONS', at, `Option "${duplicate}" is listed twice.`)
      column.options = [...names]
    }
    const multiple = readBooleanField(options, 'multiple', optionsPointer, report)
    if (multiple !== undefined) column.multiple = multiple
  }
  if (type === 'currency') {
    const code = readStringField(options, 'currencyCode', optionsPointer, report)
    if (code !== undefined) {
      if (CURRENCY_CODE.test(code)) column.currencyCode = code
      else
        report(
          'E_DECL_SHAPE',
          fieldPointer(optionsPointer, 'currencyCode'),
          'currencyCode is a three-letter ISO 4217 code such as `USD`.'
        )
    }
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
  text: Readonly<Record<string, string>>
): { decl?: TableDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = `${KIND_DIRS.table}/${key}${DECLARATION_EXTENSION}`
  const source = text[file] ?? ''
  const read = readDeclaration(file, source, { callee: CALLEE, calls: COLUMN_CALLS })
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
  const folder = readStringField(value, 'folder', '', report)
  if (folder !== undefined && !folder.startsWith('/')) {
    report('E_DECL_SHAPE', '/folder', 'folder is a path from the root, such as `/reports`.')
  }
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
      const column = readColumn(columnKey, raw, pointer, report)
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
  if (column.options !== undefined) options.options = column.options
  if (column.multiple !== undefined) options.multiple = column.multiple
  if (column.currencyCode !== undefined) options.currencyCode = column.currencyCode
  return Object.keys(options).length === 0
    ? call(`column.${column.type}`)
    : call(`column.${column.type}`, options)
}

/** The canonical column: defaults spelled out, so `required: false` and its absence agree. */
function canonicalColumn(key: string, column: TableColumnDecl): Json {
  return {
    type: column.type,
    name: columnName(key, column),
    required: column.required === true,
    unique: column.unique === true,
    ...(column.type === 'select'
      ? { options: column.options ?? [], multiple: column.multiple === true }
      : {}),
    ...(column.type === 'currency'
      ? { currencyCode: column.currencyCode ?? DEFAULT_CURRENCY_CODE }
      : {}),
  }
}

export const tableCodec: KindCodec<TableDecl> = {
  kind: 'table',
  dir: KIND_DIRS.table,
  group: (paths) => groupByFile(KIND_DIRS.table, DECLARATION_EXTENSION, paths),
  parse: (key, text) => parseTable(key, text),
  print(key, decl) {
    const value: Record<string, Json> = { name: decl.name }
    if (decl.description !== undefined) value.description = decl.description
    if (decl.folder !== undefined) value.folder = decl.folder
    value.columns = Object.fromEntries(
      Object.entries(decl.columns).map(([columnKey, column]) => [columnKey, printColumn(column)])
    )
    return {
      text: {
        [`${KIND_DIRS.table}/${key}${DECLARATION_EXTENSION}`]: printDeclaration(CALLEE, value),
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
