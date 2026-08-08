import { isValidUuid } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import {
  SNOWFLAKE_BINDING_TYPES,
  type SnowflakeBinding,
  type SnowflakeCallProcedureParams,
  type SnowflakeCancelTaskRunParams,
  type SnowflakeDeleteRowsParams,
  type SnowflakeGetTaskRunOutputParams,
  type SnowflakeGetTaskRunParams,
  type SnowflakeInsertRowsParams,
  type SnowflakeIntrospectSchemaParams,
  type SnowflakeListTaskRunsParams,
  type SnowflakeListTasksParams,
  type SnowflakeLoadDataParams,
  type SnowflakeRunTaskParams,
  type SnowflakeTaskParams,
  type SnowflakeUpdateRowsParams,
  type SnowflakeWarehouseParams,
} from '@/tools/snowflake/types'
import { normalizeMaxRows, type SnowflakeStatementSpec } from '@/tools/snowflake/utils'

const UNQUOTED_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/
const QUOTED_IDENTIFIER = /^"(?:[^"]|"")+"$/

export function identifier(value: string): string {
  const trimmed = value.trim()
  if (UNQUOTED_IDENTIFIER.test(trimmed) || QUOTED_IDENTIFIER.test(trimmed)) return trimmed
  throw new Error(`Invalid Snowflake identifier: ${value}`)
}

export function qualifiedIdentifier(...parts: string[]): string {
  if (parts.length === 0 || parts.some((part) => !part?.trim())) {
    throw new Error('Snowflake identifier parts cannot be empty')
  }
  return parts.map(identifier).join('.')
}

function splitQualifiedIdentifier(value: string): string[] {
  const parts: string[] = []
  let start = 0
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') {
      if (quoted && value[index + 1] === '"') {
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (value[index] === '.' && !quoted) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  if (quoted) throw new Error(`Invalid Snowflake identifier: ${value}`)
  parts.push(value.slice(start))
  return parts
}

function qualifiedIdentifierValue(value: string): string {
  return qualifiedIdentifier(...splitQualifiedIdentifier(value))
}

function identifierKey(value: string): string {
  const valid = identifier(value)
  if (!valid.startsWith('"')) return `resolved:${valid.toUpperCase()}`
  const exactName = resolvedIdentifierName(valid)
  return UNQUOTED_IDENTIFIER.test(exactName) && exactName === exactName.toUpperCase()
    ? `resolved:${exactName}`
    : `quoted:${exactName}`
}

function resolvedIdentifierName(value: string): string {
  const valid = identifier(value)
  return valid.startsWith('"') ? valid.slice(1, -1).replaceAll('""', '"') : valid.toUpperCase()
}

function stringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function requireQueryId(queryId: string): string {
  const trimmed = queryId.trim()
  if (!isValidUuid(trimmed)) throw new Error('queryId must be a Snowflake UUID')
  return trimmed
}

export function normalizeBindings(
  input?: Record<string, SnowflakeBinding>
): Record<string, SnowflakeBinding> | undefined {
  if (input === undefined) return undefined
  if (!isPlainRecord(input)) {
    throw new Error('bindings must be a JSON object keyed by 1-based positions')
  }
  const normalized: Record<string, SnowflakeBinding> = {}
  let hasBindings = false
  for (const position in input) {
    if (!Object.hasOwn(input, position)) continue
    hasBindings = true
    const binding = input[position]
    if (!/^[1-9][0-9]*$/.test(position)) {
      throw new Error('binding keys must be positive integer positions')
    }
    if (!isPlainRecord(binding)) {
      throw new Error(`binding ${position} must contain type and value`)
    }
    if (!SNOWFLAKE_BINDING_TYPES.includes(binding.type)) {
      throw new Error(`Unsupported Snowflake binding type: ${binding.type}`)
    }
    if (typeof binding.value !== 'string') {
      throw new Error(`binding ${position} value must be a string`)
    }
    normalized[position] = { type: binding.type, value: binding.value }
  }
  return hasBindings ? normalized : undefined
}

class BindingsBuilder {
  readonly bindings: Record<string, SnowflakeBinding> = {}
  private position = 0

  private addBinding(type: SnowflakeBinding['type'], value: string): string {
    this.position += 1
    const key = String(this.position)
    this.bindings[key] = { type, value }
    return '?'
  }

  add(value: unknown): string {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'boolean') {
      return this.addBinding('BOOLEAN', String(value))
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Snowflake row values must be finite numbers')
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new Error(
          'Snowflake integer row values must be JavaScript safe integers; pass exact large numerics as strings or typed Execute SQL bindings'
        )
      }
      return this.addBinding(Number.isInteger(value) ? 'FIXED' : 'REAL', String(value))
    }
    if (typeof value === 'string') {
      return this.addBinding('TEXT', value)
    }
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      this.addBinding('TEXT', JSON.stringify(value))
      return 'PARSE_JSON(?)'
    }
    throw new Error(`Unsupported Snowflake row value type: ${typeof value}`)
  }
}

function validateRows(rows: Array<Record<string, unknown>>): string[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('rows must be a non-empty array')
  const columns = Object.keys(rows[0] ?? {})
  if (columns.length === 0) throw new Error('rows must contain at least one column')
  const signature = [...columns].sort().join('\u0000')
  const identifierKeys = new Set<string>()
  for (const column of columns) {
    const key = identifierKey(column)
    if (identifierKeys.has(key)) {
      throw new Error(`rows contain duplicate Snowflake column identifiers: ${column}`)
    }
    identifierKeys.add(key)
  }
  for (const row of rows) {
    if (!row || Array.isArray(row) || typeof row !== 'object') {
      throw new Error('every row must be a JSON object')
    }
    if ([...Object.keys(row)].sort().join('\u0000') !== signature) {
      throw new Error('every row must contain the same columns')
    }
  }
  return columns
}

function valuesSource(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  binds: BindingsBuilder
) {
  const values = rows
    .map((row) => `(${columns.map((column) => binds.add(row[column])).join(', ')})`)
    .join(', ')
  return `(SELECT * FROM VALUES ${values}) AS source (${columns.map(identifier).join(', ')})`
}

export function buildInsertRows(params: SnowflakeInsertRowsParams): SnowflakeStatementSpec {
  const columns = validateRows(params.rows)
  const binds = new BindingsBuilder()
  const values = params.rows
    .map((row) => `(${columns.map((column) => binds.add(row[column])).join(', ')})`)
    .join(', ')
  return {
    statement: `INSERT INTO ${qualifiedIdentifier(params.database, params.schema, params.table)} (${columns.map(identifier).join(', ')}) VALUES ${values}`,
    bindings: binds.bindings,
  }
}

function buildMerge(params: SnowflakeUpdateRowsParams, upsert: boolean): SnowflakeStatementSpec {
  const columns = validateRows(params.rows)
  if (!Array.isArray(params.matchColumns) || params.matchColumns.length === 0) {
    throw new Error('matchColumns must be a non-empty array')
  }
  if (params.matchColumns.length > columns.length) {
    throw new Error('matchColumns cannot exceed the number of row columns')
  }
  const columnsByIdentifier = new Map(columns.map((column) => [identifierKey(column), column]))
  const matchColumns: string[] = []
  const seenMatchColumns = new Set<string>()
  for (const matchColumn of params.matchColumns) {
    const key = identifierKey(matchColumn)
    if (seenMatchColumns.has(key)) {
      throw new Error(`matchColumns contains a duplicate Snowflake identifier: ${matchColumn}`)
    }
    seenMatchColumns.add(key)
    const column = columnsByIdentifier.get(key)
    if (!column) throw new Error(`match column is missing from rows: ${matchColumn}`)
    matchColumns.push(column)
  }
  const updateColumns = columns.filter((column) => !matchColumns.includes(column))
  if (updateColumns.length === 0) throw new Error('rows must contain a column to update')

  const binds = new BindingsBuilder()
  const source = valuesSource(params.rows, columns, binds)
  const target = qualifiedIdentifier(params.database, params.schema, params.table)
  const on = matchColumns
    .map((column) => `EQUAL_NULL(target.${identifier(column)}, source.${identifier(column)})`)
    .join(' AND ')
  const update = updateColumns
    .map((column) => `target.${identifier(column)} = source.${identifier(column)}`)
    .join(', ')
  const insert = upsert
    ? ` WHEN NOT MATCHED THEN INSERT (${columns.map(identifier).join(', ')}) VALUES (${columns.map((column) => `source.${identifier(column)}`).join(', ')})`
    : ''
  return {
    statement: `MERGE INTO ${target} AS target USING ${source} ON ${on} WHEN MATCHED THEN UPDATE SET ${update}${insert}`,
    bindings: binds.bindings,
  }
}

export function buildUpdateRows(params: SnowflakeUpdateRowsParams): SnowflakeStatementSpec {
  return buildMerge(params, false)
}

export function buildUpsertRows(params: SnowflakeUpdateRowsParams): SnowflakeStatementSpec {
  return buildMerge(params, true)
}

export function buildDeleteRows(params: SnowflakeDeleteRowsParams): SnowflakeStatementSpec {
  if (!params.filters || Array.isArray(params.filters) || typeof params.filters !== 'object') {
    throw new Error('filters must be a JSON object')
  }
  const filters = Object.entries(params.filters)
  if (filters.length === 0) throw new Error('filters cannot be empty')
  const binds = new BindingsBuilder()
  const where = filters
    .map(([column, value]) =>
      value === null || value === undefined
        ? `${identifier(column)} IS NULL`
        : `${identifier(column)} = ${binds.add(value)}`
    )
    .join(' AND ')
  return {
    statement: `DELETE FROM ${qualifiedIdentifier(params.database, params.schema, params.table)} WHERE ${where}`,
    bindings: binds.bindings,
  }
}

function stagePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('@')) {
    throw new Error('stagePath must be a simple Snowflake stage reference such as @stage/path')
  }
  let slash = -1
  let quoted = false
  for (let index = 1; index < trimmed.length; index += 1) {
    if (trimmed[index] === '"') {
      if (quoted && trimmed[index + 1] === '"') index += 1
      else quoted = !quoted
    } else if (trimmed[index] === '/' && !quoted) {
      slash = index
      break
    }
  }
  if (quoted) throw new Error('stagePath contains an unterminated quoted identifier')
  const reference = trimmed.slice(1, slash === -1 ? undefined : slash)
  const path = slash === -1 ? '' : trimmed.slice(slash)
  if (!/^\/[A-Za-z0-9_./=+@%$-]*$/.test(path) && path !== '') {
    throw new Error('stagePath contains unsupported path characters')
  }
  if (reference === '~') return `@~${path}`
  if (reference.startsWith('%')) return `@%${identifier(reference.slice(1))}${path}`
  const referenceParts = splitQualifiedIdentifier(reference)
  const finalPart = referenceParts.at(-1)
  if (finalPart?.startsWith('%')) {
    const namespace = referenceParts.slice(0, -1)
    if (namespace.length === 0) throw new Error('stagePath contains an invalid table stage')
    return `@${qualifiedIdentifier(...namespace)}.%${identifier(finalPart.slice(1))}${path}`
  }
  return `@${qualifiedIdentifierValue(reference)}${path}`
}

export function buildLoadData(params: SnowflakeLoadDataParams): SnowflakeStatementSpec {
  const clauses = [
    `COPY INTO ${qualifiedIdentifier(params.database, params.schema, params.table)}`,
    `FROM ${stagePath(params.stagePath)}`,
  ]
  if (params.fileFormat?.trim()) {
    const formatName = qualifiedIdentifierValue(params.fileFormat.trim())
    clauses.push(`FILE_FORMAT = (FORMAT_NAME = ${stringLiteral(formatName)})`)
  }
  if (params.pattern?.trim()) clauses.push(`PATTERN = ${stringLiteral(params.pattern.trim())}`)
  if (params.onError) {
    const percentMatch = params.onError.match(/^SKIP_FILE_([0-9]+(?:\.[0-9]+)?)%$/)
    const percentage = percentMatch ? Number(percentMatch[1]) : undefined
    const validOnError =
      ['ABORT_STATEMENT', 'CONTINUE', 'SKIP_FILE'].includes(params.onError) ||
      /^SKIP_FILE_[1-9][0-9]*$/.test(params.onError) ||
      (percentage !== undefined && percentage > 0 && percentage <= 100)
    if (!validOnError) {
      throw new Error('Unsupported COPY INTO onError value')
    }
    clauses.push(`ON_ERROR = ${stringLiteral(params.onError)}`)
  }
  if (params.purge !== undefined) clauses.push(`PURGE = ${params.purge ? 'TRUE' : 'FALSE'}`)
  if (params.force !== undefined) clauses.push(`FORCE = ${params.force ? 'TRUE' : 'FALSE'}`)
  if (params.matchByColumnName) {
    if (!['CASE_SENSITIVE', 'CASE_INSENSITIVE', 'NONE'].includes(params.matchByColumnName)) {
      throw new Error('Unsupported MATCH_BY_COLUMN_NAME value')
    }
    clauses.push(`MATCH_BY_COLUMN_NAME = ${params.matchByColumnName}`)
  }
  return { statement: clauses.join(' ') }
}

export function buildListWarehouses(nameLike?: string): SnowflakeStatementSpec {
  return {
    statement: `SHOW WAREHOUSES${nameLike?.trim() ? ` LIKE ${stringLiteral(nameLike.trim())}` : ''}`,
  }
}

export function buildGetWarehouse(params: SnowflakeWarehouseParams): SnowflakeStatementSpec {
  const warehouseName = resolvedIdentifierName(params.warehouseName)
  return {
    statement: `SHOW WAREHOUSES ->> SELECT * FROM $1 WHERE "name" = ${stringLiteral(warehouseName)}`,
  }
}

export function buildResumeWarehouse(params: SnowflakeWarehouseParams): SnowflakeStatementSpec {
  return { statement: `ALTER WAREHOUSE ${identifier(params.warehouseName)} RESUME IF SUSPENDED` }
}

export function buildSuspendWarehouse(params: SnowflakeWarehouseParams): SnowflakeStatementSpec {
  return { statement: `ALTER WAREHOUSE ${identifier(params.warehouseName)} SUSPEND` }
}

export function buildListTasks(params: SnowflakeListTasksParams): SnowflakeStatementSpec {
  const limit = normalizeMaxRows(params.limit)
  return {
    statement: `SHOW TASKS${params.nameLike?.trim() ? ` LIKE ${stringLiteral(params.nameLike.trim())}` : ''} IN SCHEMA ${qualifiedIdentifier(params.database, params.schema)} LIMIT ${limit}`,
  }
}

export function buildGetTask(params: SnowflakeTaskParams): SnowflakeStatementSpec {
  return {
    statement: `DESCRIBE TASK ${qualifiedIdentifier(params.database, params.schema, params.taskName)}`,
  }
}

export function buildRunTask(params: SnowflakeRunTaskParams): SnowflakeStatementSpec {
  return {
    statement: `EXECUTE TASK ${qualifiedIdentifier(params.database, params.schema, params.taskName)}${params.retryLast ? ' RETRY LAST' : ''}`,
  }
}

export function buildListTaskRuns(params: SnowflakeListTaskRunsParams): SnowflakeStatementSpec {
  const limit = normalizeMaxRows(params.limit)
  const binds = new BindingsBuilder()
  const args = [`RESULT_LIMIT => ${limit}`, `ERROR_ONLY => ${params.errorOnly ? 'TRUE' : 'FALSE'}`]
  if (params.taskName?.trim()) args.push(`TASK_NAME => ${binds.add(params.taskName.trim())}`)
  if (params.startTime?.trim()) {
    args.push(
      `SCHEDULED_TIME_RANGE_START => TO_TIMESTAMP_LTZ(${binds.add(params.startTime.trim())})`
    )
  }
  if (params.endTime?.trim()) {
    args.push(`SCHEDULED_TIME_RANGE_END => TO_TIMESTAMP_LTZ(${binds.add(params.endTime.trim())})`)
  }
  return {
    statement: `SELECT * FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(${args.join(', ')})) ORDER BY SCHEDULED_TIME DESC`,
    bindings: binds.bindings,
  }
}

export function buildGetTaskRun(params: SnowflakeGetTaskRunParams): SnowflakeStatementSpec {
  const binds = new BindingsBuilder()
  const args = ['RESULT_LIMIT => 10000']
  if (params.taskName?.trim()) args.push(`TASK_NAME => ${binds.add(params.taskName.trim())}`)
  if (params.startTime?.trim()) {
    args.push(
      `SCHEDULED_TIME_RANGE_START => TO_TIMESTAMP_LTZ(${binds.add(params.startTime.trim())})`
    )
  }
  if (params.endTime?.trim()) {
    args.push(`SCHEDULED_TIME_RANGE_END => TO_TIMESTAMP_LTZ(${binds.add(params.endTime.trim())})`)
  }
  const queryId = binds.add(requireQueryId(params.queryId))
  return {
    statement: `SELECT * FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(${args.join(', ')})) WHERE QUERY_ID = ${queryId} LIMIT 1`,
    bindings: binds.bindings,
  }
}

export function buildCancelTaskRun(params: SnowflakeCancelTaskRunParams): SnowflakeStatementSpec {
  return {
    statement: `SELECT SYSTEM$CANCEL_QUERY(${stringLiteral(requireQueryId(params.queryId))}) AS STATUS`,
  }
}

export function buildGetTaskRunOutput(
  params: SnowflakeGetTaskRunOutputParams
): SnowflakeStatementSpec {
  return {
    statement: `SELECT * FROM TABLE(RESULT_SCAN(${stringLiteral(requireQueryId(params.queryId))}))`,
  }
}

export function buildIntrospectSchema(
  params: SnowflakeIntrospectSchemaParams
): SnowflakeStatementSpec {
  const binds = new BindingsBuilder()
  const filters: string[] = []
  if (params.schema?.trim()) {
    filters.push(`c.TABLE_SCHEMA = ${binds.add(resolvedIdentifierName(params.schema))}`)
  }
  if (params.table?.trim()) {
    filters.push(`c.TABLE_NAME = ${binds.add(resolvedIdentifierName(params.table))}`)
  }
  if (!params.includeViews) filters.push("t.TABLE_TYPE = 'BASE TABLE'")
  const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : ''
  return {
    statement: `SELECT c.TABLE_CATALOG, c.TABLE_SCHEMA, c.TABLE_NAME, t.TABLE_TYPE, t.ROW_COUNT, t.BYTES, c.COLUMN_NAME, c.ORDINAL_POSITION, c.COLUMN_DEFAULT, c.IS_NULLABLE, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.COMMENT FROM ${identifier(params.database)}.INFORMATION_SCHEMA.COLUMNS AS c JOIN ${identifier(params.database)}.INFORMATION_SCHEMA.TABLES AS t ON c.TABLE_CATALOG = t.TABLE_CATALOG AND c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME${where} ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
    bindings: binds.bindings,
  }
}

export function buildCallProcedure(params: SnowflakeCallProcedureParams): SnowflakeStatementSpec {
  const procedureArguments = params.procedureArguments ?? []
  if (!Array.isArray(procedureArguments)) {
    throw new Error('procedureArguments must be a JSON array')
  }
  const bindings = normalizeBindings(
    Object.fromEntries(procedureArguments.map((argument, index) => [String(index + 1), argument]))
  )
  const placeholders = procedureArguments.map(() => '?')
  return {
    statement: `CALL ${qualifiedIdentifier(params.database, params.schema, params.procedureName)}(${placeholders.join(', ')})`,
    bindings,
  }
}
