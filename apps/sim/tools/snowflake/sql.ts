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

/**
 * Snowflake processes backslash escape sequences inside single-quoted string constants, so both the
 * backslash and the quote have to be doubled. Quote doubling never introduces a backslash, so the
 * two passes commute; the order below is not load-bearing.
 */
function stringLiteral(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

function requireQueryId(queryId: string): string {
  const trimmed = queryId.trim()
  if (!isValidUuid(trimmed)) throw new Error('queryId must be a Snowflake UUID')
  return trimmed
}

/**
 * Snowflake recommends limiting query text to 1 MB per statement, and that limit explicitly covers
 * values supplied through bindings. Statements above it still execute but are truncated before the
 * metadata store persists them, so they can no longer be retried or inspected.
 *
 * The budget is a byte budget, so it is measured against the UTF-8 encoding rather than the
 * JavaScript string length — a multi-byte string is up to 3x longer on the wire than in code units.
 */
const MAX_BOUND_VALUE_BYTES = 1_000_000

const BULK_INGEST_HINT = 'stage the data and use snowflake_load_data for bulk ingest'

function assertBoundBytesWithinBudget(boundBytes: number): void {
  if (boundBytes > MAX_BOUND_VALUE_BYTES) {
    throw new Error(
      `Snowflake bound values exceed the ${MAX_BOUND_VALUE_BYTES} byte statement budget; send fewer rows per call or ${BULK_INGEST_HINT}`
    )
  }
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
  let boundBytes = 0
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
    boundBytes += Buffer.byteLength(binding.value, 'utf8')
    assertBoundBytesWithinBudget(boundBytes)
    normalized[position] = { type: binding.type, value: binding.value }
  }
  return hasBindings ? normalized : undefined
}

/**
 * Structured writes build a single statement holding every row, so the row count is capped well
 * below the byte budget to keep a typical write far away from the 1 MB statement recommendation.
 */
const MAX_WRITE_ROWS = 1_000

class BindingsBuilder {
  readonly bindings: Record<string, SnowflakeBinding> = {}
  private position = 0
  private boundBytes = 0

  private addBinding(type: SnowflakeBinding['type'], value: string): string {
    this.boundBytes += Buffer.byteLength(value, 'utf8')
    assertBoundBytesWithinBudget(this.boundBytes)
    this.position += 1
    const key = String(this.position)
    this.bindings[key] = { type, value }
    return '?'
  }

  /** Binds a semi-structured value as text so the statement can wrap it in PARSE_JSON. */
  addJson(value: unknown): string {
    return this.addBinding('TEXT', JSON.stringify(value) ?? 'null')
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
  if (rows.length > MAX_WRITE_ROWS) {
    throw new Error(
      `rows cannot exceed ${MAX_WRITE_ROWS} per call; send the rows in smaller batches or ${BULK_INGEST_HINT}`
    )
  }
  const columns = Object.keys(rows[0] ?? {})
  if (columns.length === 0) throw new Error('rows must contain at least one column')
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
    if (
      Object.keys(row).length !== columns.length ||
      !columns.every((column) => Object.hasOwn(row, column))
    ) {
      throw new Error('every row must contain the same columns')
    }
  }
  return columns
}

function isSemiStructured(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

interface RowsSource {
  /** `(?, ?), (?, NULL)` — the literal rows of the derived table. */
  values: string
  /** Projection that restores semi-structured columns, aliased back to the row column names. */
  selectList: string
  /** Column aliases of the derived table, in row column order. */
  aliases: string[]
  /** True when any column had to be routed through PARSE_JSON. */
  hasSemiStructured: boolean
}

/**
 * Builds the bound row literals plus the projection that converts them back to their target types.
 *
 * Snowflake rejects semi-structured expressions inside a VALUES clause and documents INSERT ... SELECT
 * as the supported alternative, so PARSE_JSON is lifted out of the VALUES rows into a projecting
 * SELECT. A column is converted whole-column rather than per-value so that a mixed column still
 * produces one consistent VARIANT type.
 */
function buildRowsSource(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  binds: BindingsBuilder
): RowsSource {
  const semiStructured = new Set(
    columns.filter((column) => rows.some((row) => isSemiStructured(row[column])))
  )
  const aliases = columns.map((_, index) => `C${index + 1}`)
  const values = rows
    .map(
      (row) =>
        `(${columns
          .map((column) => {
            const value = row[column]
            if (value === null || value === undefined) return 'NULL'
            return semiStructured.has(column) ? binds.addJson(value) : binds.add(value)
          })
          .join(', ')})`
    )
    .join(', ')
  const selectList = columns
    .map((column, index) => {
      const alias = aliases[index]
      const expression = semiStructured.has(column) ? `PARSE_JSON(${alias})` : alias
      return `${expression} AS ${identifier(column)}`
    })
    .join(', ')
  return { values, selectList, aliases, hasSemiStructured: semiStructured.size > 0 }
}

function valuesSource(source: RowsSource): string {
  return `(SELECT ${source.selectList} FROM (VALUES ${source.values}) AS v (${source.aliases.join(', ')})) AS source`
}

export function buildInsertRows(params: SnowflakeInsertRowsParams): SnowflakeStatementSpec {
  const columns = validateRows(params.rows)
  const binds = new BindingsBuilder()
  const source = buildRowsSource(params.rows, columns, binds)
  const target = qualifiedIdentifier(params.database, params.schema, params.table)
  const columnList = columns.map(identifier).join(', ')
  const statement = source.hasSemiStructured
    ? `INSERT INTO ${target} (${columnList}) SELECT ${source.selectList} FROM (VALUES ${source.values}) AS v (${source.aliases.join(', ')})`
    : `INSERT INTO ${target} (${columnList}) VALUES ${source.values}`
  return { statement, bindings: binds.bindings }
}

/**
 * Rejects match keys the MERGE cannot resolve deterministically.
 *
 * A NULL match value never satisfies the equality join, so such a row would silently fall through
 * to the not-matched branch. Two source rows sharing a match key join the same target row, which
 * Snowflake reports as a nondeterministic merge — with ERROR_ON_NONDETERMINISTIC_MERGE at its TRUE
 * default the whole statement fails server-side without naming the offending key.
 */
function assertDistinctMatchKeys(
  rows: Array<Record<string, unknown>>,
  matchColumns: string[]
): void {
  const seen = new Set<string>()
  for (const row of rows) {
    const parts: string[] = []
    const display: string[] = []
    for (const column of matchColumns) {
      const value = row[column]
      if (value === null || value === undefined) {
        throw new Error(`match column cannot be null in a row: ${column}`)
      }
      parts.push(JSON.stringify(typeof value === 'object' ? ['object', value] : String(value)))
      display.push(
        `${typeof value}:${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
      )
    }
    const key = parts.join('\u0000')
    if (seen.has(key)) {
      throw new Error(
        `rows contain duplicate match key values for ${matchColumns.join(', ')}: ${display.join(', ')}`
      )
    }
    seen.add(key)
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
    if (typeof matchColumn !== 'string') {
      throw new Error('every matchColumns entry must be a column name string')
    }
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

  assertDistinctMatchKeys(params.rows, matchColumns)

  const binds = new BindingsBuilder()
  const source = valuesSource(buildRowsSource(params.rows, columns, binds))
  const target = qualifiedIdentifier(params.database, params.schema, params.table)
  const on = matchColumns
    .map((column) => `target.${identifier(column)} = source.${identifier(column)}`)
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
  const identifierKeys = new Set<string>()
  for (const [column] of filters) {
    const key = identifierKey(column)
    if (identifierKeys.has(key)) {
      throw new Error(`filters contain duplicate Snowflake column identifiers: ${column}`)
    }
    identifierKeys.add(key)
  }
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
  if (path.includes('--')) {
    throw new Error('stagePath cannot contain a SQL line comment')
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

/**
 * COPY INTO's grammar is positional up to the copy options: FROM, then FILES, then PATTERN, then
 * FILE_FORMAT, then copyOptions. Only the copy options themselves (ON_ERROR, PURGE, FORCE,
 * MATCH_BY_COLUMN_NAME) are order-free, and they must all follow FILE_FORMAT.
 */
export function buildLoadData(params: SnowflakeLoadDataParams): SnowflakeStatementSpec {
  const clauses = [
    `COPY INTO ${qualifiedIdentifier(params.database, params.schema, params.table)}`,
    `FROM ${stagePath(params.stagePath)}`,
  ]
  if (params.pattern?.trim()) clauses.push(`PATTERN = ${stringLiteral(params.pattern.trim())}`)
  if (params.fileFormat?.trim()) {
    const formatName = qualifiedIdentifierValue(params.fileFormat.trim())
    clauses.push(`FILE_FORMAT = (FORMAT_NAME = ${stringLiteral(formatName)})`)
  }
  if (params.onError) {
    const percentMatch = params.onError.match(/^SKIP_FILE_([0-9]+)%$/)
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

/**
 * TASK_HISTORY documents that "Only non-qualified task names are supported" — a qualified name
 * yields an empty result set rather than an error. The name is also resolved the way Snowflake
 * stored it, so an unquoted name is upper-cased and a quoted one keeps its exact spelling.
 */
/**
 * TASK_HISTORY time-range arguments are `constant_expr` and are not in BCR-1410's bind
 * allowlist for this function, which covers only RESULT_LIMIT and TASK_NAME. A bind here
 * is silently dropped rather than rejected, which would turn the requested window into a
 * no-op, so the timestamp is emitted as a literal instead.
 */
function taskHistoryTimestamp(value: string, field: string): string {
  const trimmed = value.trim()
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new Error(`${field} must be an ISO-8601 timestamp within the last seven days`)
  }
  return `TO_TIMESTAMP_LTZ(${stringLiteral(trimmed)})`
}

function unqualifiedTaskName(value: string): string {
  const trimmed = value.trim()
  if (splitQualifiedIdentifier(trimmed).length > 1) {
    throw new Error(
      `taskName must be an unqualified task name without a database or schema prefix: ${trimmed}`
    )
  }
  return resolvedIdentifierName(trimmed)
}

export function buildListTaskRuns(params: SnowflakeListTaskRunsParams): SnowflakeStatementSpec {
  const limit = normalizeMaxRows(params.limit)
  const binds = new BindingsBuilder()
  const args = [`RESULT_LIMIT => ${limit}`, `ERROR_ONLY => ${params.errorOnly ? 'TRUE' : 'FALSE'}`]
  if (params.taskName?.trim()) {
    args.push(`TASK_NAME => ${binds.add(unqualifiedTaskName(params.taskName))}`)
  }
  if (params.startTime?.trim()) {
    args.push(
      `SCHEDULED_TIME_RANGE_START => ${taskHistoryTimestamp(params.startTime, 'startTime')}`
    )
  }
  if (params.endTime?.trim()) {
    args.push(`SCHEDULED_TIME_RANGE_END => ${taskHistoryTimestamp(params.endTime, 'endTime')}`)
  }
  return {
    statement: `SELECT * FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.TASK_HISTORY(${args.join(', ')})) ORDER BY SCHEDULED_TIME DESC`,
    bindings: binds.bindings,
  }
}

export function buildGetTaskRun(params: SnowflakeGetTaskRunParams): SnowflakeStatementSpec {
  const binds = new BindingsBuilder()
  const args = ['RESULT_LIMIT => 10000']
  if (params.taskName?.trim()) {
    args.push(`TASK_NAME => ${binds.add(unqualifiedTaskName(params.taskName))}`)
  }
  if (params.startTime?.trim()) {
    args.push(
      `SCHEDULED_TIME_RANGE_START => ${taskHistoryTimestamp(params.startTime, 'startTime')}`
    )
  }
  if (params.endTime?.trim()) {
    args.push(`SCHEDULED_TIME_RANGE_END => ${taskHistoryTimestamp(params.endTime, 'endTime')}`)
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

/**
 * INFORMATION_SCHEMA.TABLES.TABLE_TYPE is one of BASE TABLE, TEMPORARY TABLE, EXTERNAL TABLE,
 * EVENT TABLE, VIEW, or MATERIALIZED VIEW. Excluding only the view types keeps every table kind
 * visible; matching 'BASE TABLE' alone would silently hide temporary, external, and event tables.
 */
const VIEW_TABLE_TYPES = ["'VIEW'", "'MATERIALIZED VIEW'"] as const

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
  if (!params.includeViews) filters.push(`t.TABLE_TYPE NOT IN (${VIEW_TABLE_TYPES.join(', ')})`)
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
