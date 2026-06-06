import {
  validateDatabaseHost,
  validateSqlWhereClause,
} from '@/lib/core/security/input-validation.server'
import type { ClickHouseConnectionConfig } from '@/tools/clickhouse/types'

const REQUEST_TIMEOUT_MS = 30_000

interface ClickHouseSummary {
  read_rows?: string
  written_rows?: string
  result_rows?: string
}

interface ClickHouseHttpResult {
  text: string
  summary: ClickHouseSummary | null
}

export interface ClickHouseRowsResult {
  rows: unknown[]
  rowCount: number
}

interface ClickHouseColumnRow {
  table: string
  name: string
  type: string
  default_kind?: string
  default_expression?: string
  is_in_primary_key?: number | string
  is_in_sorting_key?: number | string
  position?: number | string
}

interface ClickHouseTableRow {
  name: string
  engine?: string
  total_rows?: number | string | null
}

export interface ClickHouseIntrospectionResult {
  tables: Array<{
    name: string
    database: string
    engine: string
    totalRows?: number
    columns: Array<{
      name: string
      type: string
      defaultKind?: string
      defaultExpression?: string
      isInPrimaryKey: boolean
      isInSortingKey: boolean
    }>
  }>
}

/**
 * Sends a single statement to the ClickHouse HTTP interface and returns the raw
 * response body alongside the parsed `X-ClickHouse-Summary` header.
 * @see https://clickhouse.com/docs/interfaces/http
 */
async function clickhouseRequest(
  config: ClickHouseConnectionConfig,
  statement: string,
  options: { readOnly?: boolean } = {}
): Promise<ClickHouseHttpResult> {
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const protocol = config.secure ? 'https' : 'http'
  const url = new URL(`${protocol}://${config.host}:${config.port}/`)
  url.searchParams.set('database', config.database)
  if (options.readOnly) {
    // Server-enforced read-only: ClickHouse rejects any write/DDL and forbids the
    // query from re-enabling writes via `SET readonly=0`. This is the real boundary
    // for the query operation; the SQL-shape checks below are defense-in-depth.
    url.searchParams.set('readonly', '1')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'X-ClickHouse-User': config.username,
        'X-ClickHouse-Key': config.password,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: statement,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  const text = await response.text()

  if (!response.ok) {
    throw new Error(text.trim() || `ClickHouse request failed with status ${response.status}`)
  }

  return { text, summary: parseSummary(response.headers.get('x-clickhouse-summary')) }
}

function parseSummary(header: string | null): ClickHouseSummary | null {
  if (!header) return null
  try {
    return JSON.parse(header) as ClickHouseSummary
  } catch {
    return null
  }
}

/**
 * Parses a ClickHouse `FORMAT JSON` response body into rows, falling back to the
 * summary header's row counts for statements that do not return a result set.
 */
function parseRowsResult(result: ClickHouseHttpResult): ClickHouseRowsResult {
  const trimmed = result.text.trim()
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as { data?: unknown[]; rows?: number }
      if (parsed && Array.isArray(parsed.data)) {
        const rowCount = typeof parsed.rows === 'number' ? parsed.rows : parsed.data.length
        return { rows: parsed.data, rowCount }
      }
    } catch {
      // Body was not JSON (e.g. a non-SELECT statement); fall through to summary.
    }
  }

  const written = Number(result.summary?.written_rows ?? 0)
  const read = Number(result.summary?.read_rows ?? 0)
  return { rows: [], rowCount: written || read || 0 }
}

/** Read-only statement leaders that return a result set and never mutate data. */
const READ_ONLY_STATEMENT = /^(select|with|show|describe|desc|explain|exists)\b/i

/**
 * Normalizes the output format of a read statement to JSON so the HTTP response
 * can always be parsed into rows. Strips every `FORMAT <name>` clause — wherever
 * it sits relative to a trailing `SETTINGS` clause — and appends a single canonical
 * `FORMAT JSON`. The `format()` function and `FORMAT`/format names appearing inside
 * strings or comments are ignored (the scan runs on comment/string-masked SQL).
 * Non-read statements are returned untouched (their own FORMAT, e.g. JSONEachRow
 * for inserts, is preserved).
 */
function ensureJsonFormat(query: string): string {
  const trimmed = query.trim().replace(/;+\s*$/, '')
  if (!READ_ONLY_STATEMENT.test(trimmed)) {
    return trimmed
  }
  const masked = maskSqlNoise(trimmed)
  const formatClause = /\bformat\s+[a-z0-9_]+\b/gi
  const spans: Array<[number, number]> = []
  for (let match = formatClause.exec(masked); match !== null; match = formatClause.exec(masked)) {
    spans.push([match.index, match.index + match[0].length])
  }
  let result = trimmed
  for (let i = spans.length - 1; i >= 0; i--) {
    result = result.slice(0, spans[i][0]) + result.slice(spans[i][1])
  }
  return `${result.replace(/\s+$/, '')}\nFORMAT JSON`
}

/**
 * Replaces string literals ('...'), quoted identifiers ("..." / `...`), and SQL
 * comments (`-- …` and `/* … *​/`) with spaces so that structural scans (e.g. for
 * statement-chaining semicolons) only see actual SQL code, not data or comments.
 */
function maskSqlNoise(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ' '
      i++
      while (i < sql.length && sql[i] !== ch) {
        if (ch !== '`' && sql[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        out += ' '
        i++
      }
      if (i < sql.length) {
        out += ' '
        i++
      }
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const newline = sql.indexOf('\n', i + 2)
      const end = newline === -1 ? sql.length : newline
      out += ' '.repeat(end - i)
      i = end
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2)
      const end = close === -1 ? sql.length : close + 2
      out += ' '.repeat(end - i)
      i = end
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Detects whether a statement chains a second statement after a `;`, ignoring
 * semicolons inside string literals, quoted identifiers, and comments. A trailing
 * semicolon (with only whitespace/comments after it) is allowed.
 */
function hasChainedStatement(sql: string): boolean {
  return /;\s*\S/.test(maskSqlNoise(sql))
}

/**
 * Write/DDL statement shapes that must never run under the read-only query
 * operation, even when wrapped by a leading `WITH` CTE (e.g. `WITH … INSERT INTO …`).
 * Patterns require the keyword's statement context (e.g. `insert into`, `alter table`)
 * so SQL functions/columns like `truncate(x)` or `created_at` are not false-positives.
 */
const MUTATING_STATEMENT = [
  /\binsert\s+into\b/i,
  /\bdelete\s+from\b/i,
  /\bupdate\s+[\w.`"]+\s+set\b/i,
  /\balter\s+table\b/i,
  /\b(?:create|attach)\s+(?:or\s+replace\s+)?(?:temporary\s+)?(?:table|database|dictionary|view|materialized\s+view|live\s+view|function|user|role)\b/i,
  /\bdrop\s+(?:table|database|dictionary|view|column|partition|index|function|user|role)\b/i,
  /\btruncate\s+table\b/i,
  /\brename\s+(?:table|database|dictionary)\b/i,
  /\bdetach\s+(?:table|database|dictionary|view|permanently)\b/i,
  /\b(?:grant|revoke)\b/i,
  /\boptimize\s+table\b/i,
]

/** Whether a statement performs a write/DDL anywhere (comments and strings masked out). */
function isMutatingStatement(sql: string): boolean {
  const masked = maskSqlNoise(sql)
  return MUTATING_STATEMENT.some((pattern) => pattern.test(masked))
}

/**
 * Strips leading whitespace, `--`/`/* … *​/` comments, and opening parens from a
 * statement so the read-only leader keyword can be detected even when a query
 * starts with a comment (e.g. `-- note\nSELECT …`) or wrapping parens.
 */
function stripLeadingNoise(sql: string): string {
  let s = sql.trim()
  for (;;) {
    if (s.startsWith('--')) {
      const newline = s.indexOf('\n')
      s = (newline === -1 ? '' : s.slice(newline + 1)).trim()
    } else if (s.startsWith('/*')) {
      const close = s.indexOf('*/')
      s = (close === -1 ? '' : s.slice(close + 2)).trim()
    } else if (s.startsWith('(')) {
      s = s.slice(1).trim()
    } else {
      return s
    }
  }
}

export async function executeClickHouseQuery(
  config: ClickHouseConnectionConfig,
  query: string,
  options: { enforceReadOnly?: boolean } = {}
): Promise<ClickHouseRowsResult> {
  if (options.enforceReadOnly) {
    // Strip leading comments/parens so wrapped or commented selects still validate.
    const leader = stripLeadingNoise(query)
    if (!READ_ONLY_STATEMENT.test(leader)) {
      throw new Error(
        'The query operation only allows read-only statements (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN, EXISTS). Use the Execute Raw SQL operation to run writes or DDL.'
      )
    }
    if (hasChainedStatement(query)) {
      throw new Error(
        'The query operation only allows a single statement; chained statements separated by ";" are not allowed. Use the Execute Raw SQL operation to run multiple statements.'
      )
    }
    if (isMutatingStatement(query)) {
      throw new Error(
        'The query operation only allows read-only statements; a write or DDL statement (e.g. INSERT/ALTER/DROP, including after a WITH clause) was detected. Use the Execute Raw SQL operation instead.'
      )
    }
  }
  const result = await clickhouseRequest(config, ensureJsonFormat(query), {
    readOnly: options.enforceReadOnly,
  })
  return parseRowsResult(result)
}

export async function executeClickHouseInsert(
  config: ClickHouseConnectionConfig,
  table: string,
  data: Record<string, unknown>
): Promise<ClickHouseRowsResult> {
  const sanitizedTable = sanitizeIdentifier(table)
  const statement = `INSERT INTO ${sanitizedTable} FORMAT JSONEachRow\n${JSON.stringify(data)}`
  const result = await clickhouseRequest(config, statement)
  const written = Number(result.summary?.written_rows ?? 0)
  return { rows: [], rowCount: written || 1 }
}

export async function executeClickHouseUpdate(
  config: ClickHouseConnectionConfig,
  table: string,
  data: Record<string, unknown>,
  where: string
): Promise<ClickHouseRowsResult> {
  validateWhereClause(where)
  const sanitizedTable = sanitizeIdentifier(table)
  const assignments = Object.entries(data)
    .map(([column, value]) => `${sanitizeIdentifier(column)} = ${formatValue(value)}`)
    .join(', ')

  if (!assignments) {
    throw new Error('Update data object cannot be empty')
  }

  const statement = `ALTER TABLE ${sanitizedTable} UPDATE ${assignments} WHERE ${where}`
  const result = await clickhouseRequest(config, statement)
  return { rows: [], rowCount: Number(result.summary?.written_rows ?? 0) }
}

export async function executeClickHouseDelete(
  config: ClickHouseConnectionConfig,
  table: string,
  where: string
): Promise<ClickHouseRowsResult> {
  validateWhereClause(where)
  const sanitizedTable = sanitizeIdentifier(table)
  const statement = `ALTER TABLE ${sanitizedTable} DELETE WHERE ${where}`
  const result = await clickhouseRequest(config, statement)
  return { rows: [], rowCount: Number(result.summary?.written_rows ?? 0) }
}

export async function executeClickHouseIntrospect(
  config: ClickHouseConnectionConfig
): Promise<ClickHouseIntrospectionResult> {
  const database = quoteString(config.database)

  const tablesResult = await clickhouseRequest(
    config,
    `SELECT name, engine, total_rows FROM system.tables WHERE database = ${database} ORDER BY name FORMAT JSON`
  )
  const tableRows = parseDataArray<ClickHouseTableRow>(tablesResult.text)

  const columnsResult = await clickhouseRequest(
    config,
    `SELECT table, name, type, default_kind, default_expression, is_in_primary_key, is_in_sorting_key, position FROM system.columns WHERE database = ${database} ORDER BY table, position FORMAT JSON`
  )
  const columnRows = parseDataArray<ClickHouseColumnRow>(columnsResult.text)

  const columnsByTable = new Map<
    string,
    ClickHouseIntrospectionResult['tables'][number]['columns']
  >()
  for (const column of columnRows) {
    const columns = columnsByTable.get(column.table) ?? []
    columns.push({
      name: column.name,
      type: column.type,
      defaultKind: column.default_kind || undefined,
      defaultExpression: column.default_expression || undefined,
      isInPrimaryKey: toBoolean(column.is_in_primary_key),
      isInSortingKey: toBoolean(column.is_in_sorting_key),
    })
    columnsByTable.set(column.table, columns)
  }

  const tables = tableRows.map((table) => ({
    name: table.name,
    database: config.database,
    engine: table.engine ?? '',
    totalRows: table.total_rows != null ? Number(table.total_rows) : undefined,
    columns: columnsByTable.get(table.name) ?? [],
  }))

  return { tables }
}

function parseDataArray<T>(text: string): T[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as { data?: T[] }
    return Array.isArray(parsed.data) ? parsed.data : []
  } catch {
    return []
  }
}

function toBoolean(value: number | string | undefined): boolean {
  return value === 1 || value === '1'
}

/**
 * Quotes and escapes a value for inline use in a ClickHouse statement.
 * Strings use ClickHouse's backslash escaping for single quotes and backslashes.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL'
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0'
  }
  if (typeof value === 'object') {
    return quoteString(JSON.stringify(value))
  }
  return quoteString(String(value))
}

function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * Validates and backtick-quotes a ClickHouse identifier, supporting
 * `database.table` qualified names.
 */
export function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    return identifier
      .split('.')
      .map((part) => sanitizeSingleIdentifier(part))
      .join('.')
  }
  return sanitizeSingleIdentifier(identifier)
}

function sanitizeSingleIdentifier(identifier: string): string {
  const cleaned = identifier.replace(/`/g, '')
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }
  return `\`${cleaned}\``
}

/**
 * Rejects WHERE clauses containing SQL-injection or always-true tautology
 * patterns so user-supplied conditions cannot broaden a mutation to every row.
 * Delegates to the shared {@link validateSqlWhereClause} guard (defense-in-depth).
 */
function validateWhereClause(where: string): void {
  const result = validateSqlWhereClause(where, 'WHERE clause')
  if (!result.isValid) {
    throw new Error(result.error)
  }
}

/**
 * Runs a SELECT statement (which must already include `FORMAT JSON`) and returns
 * the parsed rows and row count.
 */
async function runSelect(
  config: ClickHouseConnectionConfig,
  statement: string
): Promise<ClickHouseRowsResult> {
  const result = await clickhouseRequest(config, statement)
  return parseRowsResult(result)
}

/**
 * Runs a statement that does not return a result set (DDL or mutation) and
 * returns the number of written rows reported by the summary header.
 */
async function runStatement(
  config: ClickHouseConnectionConfig,
  statement: string
): Promise<number> {
  const result = await clickhouseRequest(config, statement)
  return Number(result.summary?.written_rows ?? 0)
}

/**
 * Validates a free-form SQL expression (ORDER BY, PARTITION BY, engine args)
 * rejecting statement terminators and comment sequences.
 */
function validateExpression(expression: string, label: string): void {
  if (/;|--|\/\*|\*\//.test(expression)) {
    throw new Error(`${label} contains a disallowed character`)
  }
}

/**
 * Validates an ORDER BY / PARTITION BY expression that is spliced inside wrapping
 * parentheses in the generated DDL. In addition to rejecting terminators/comments,
 * it requires balanced parentheses (quote-aware) so the expression cannot close
 * the wrapping `(...)` early and append extra clauses (e.g. `id) SETTINGS …`).
 */
function validateClauseExpression(expression: string, label: string): void {
  const trimmed = expression.trim()
  if (!trimmed) {
    throw new Error(`${label} is required`)
  }
  if (/;|--|\/\*|\*\//.test(trimmed)) {
    throw new Error(`${label} contains a disallowed sequence`)
  }
  let depth = 0
  let inString = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === "'") inString = false
      continue
    }
    if (ch === "'") inString = true
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth < 0) {
        throw new Error(`${label} has unbalanced parentheses`)
      }
    }
  }
  if (inString || depth !== 0) {
    throw new Error(`${label} has unbalanced parentheses or quotes`)
  }
}

/**
 * Validates a partition value for `DROP PARTITION`. ClickHouse partition values
 * are literals (signed numbers or single-quoted strings) or a parenthesised tuple
 * of such literals, so anything else is rejected — barewords like `ALL`, function
 * calls, operators, and extra tokens that could broaden the statement beyond
 * dropping a single partition.
 */
function validatePartitionExpression(partition: string): void {
  const partitionPattern =
    /^\(?\s*(?:'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?)(?:\s*,\s*(?:'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?))*\s*\)?$/
  if (!partitionPattern.test(partition.trim())) {
    throw new Error(
      "Partition must be a literal value or a tuple of literals (number or single-quoted string), e.g. 202401, '2024-01', or (2024, 'EU')"
    )
  }
}

export function executeClickHouseListDatabases(
  config: ClickHouseConnectionConfig
): Promise<ClickHouseRowsResult> {
  return runSelect(
    config,
    'SELECT name, engine, comment FROM system.databases ORDER BY name FORMAT JSON'
  )
}

export function executeClickHouseListTables(
  config: ClickHouseConnectionConfig
): Promise<ClickHouseRowsResult> {
  return runSelect(
    config,
    `SELECT name, engine, total_rows AS totalRows, total_bytes AS totalBytes, comment FROM system.tables WHERE database = ${quoteString(config.database)} ORDER BY name FORMAT JSON`
  )
}

export function executeClickHouseDescribeTable(
  config: ClickHouseConnectionConfig,
  table: string
): Promise<ClickHouseRowsResult> {
  const tableName = stripDatabasePrefix(table)
  return runSelect(
    config,
    `SELECT name, type, default_kind AS defaultKind, default_expression AS defaultExpression, comment, is_in_primary_key AS isInPrimaryKey, is_in_sorting_key AS isInSortingKey FROM system.columns WHERE database = ${quoteString(config.database)} AND table = ${quoteString(tableName)} ORDER BY position FORMAT JSON`
  )
}

export async function executeClickHouseShowCreateTable(
  config: ClickHouseConnectionConfig,
  table: string
): Promise<string> {
  const result = await runSelect(
    config,
    `SHOW CREATE TABLE ${sanitizeIdentifier(table)} FORMAT JSON`
  )
  const firstRow = result.rows[0] as Record<string, unknown> | undefined
  if (!firstRow) {
    return ''
  }
  // ClickHouse returns the DDL in a single String column (named `statement`);
  // fall back to the first column value to stay robust to column-name changes.
  const value = firstRow.statement ?? Object.values(firstRow)[0]
  return typeof value === 'string' ? value : ''
}

export async function executeClickHouseCountRows(
  config: ClickHouseConnectionConfig,
  table: string,
  where?: string
): Promise<number> {
  let statement = `SELECT count() AS count FROM ${sanitizeIdentifier(table)}`
  if (where?.trim()) {
    validateWhereClause(where)
    statement += ` WHERE ${where}`
  }
  const result = await runSelect(config, `${statement} FORMAT JSON`)
  const firstRow = result.rows[0] as { count?: number | string } | undefined
  return firstRow?.count != null ? Number(firstRow.count) : 0
}

export function executeClickHouseListPartitions(
  config: ClickHouseConnectionConfig,
  table: string
): Promise<ClickHouseRowsResult> {
  const tableName = stripDatabasePrefix(table)
  return runSelect(
    config,
    `SELECT partition, count() AS parts, sum(rows) AS rows, sum(bytes_on_disk) AS bytesOnDisk FROM system.parts WHERE database = ${quoteString(config.database)} AND table = ${quoteString(tableName)} AND active GROUP BY partition ORDER BY partition FORMAT JSON`
  )
}

export function executeClickHouseListMutations(
  config: ClickHouseConnectionConfig,
  table?: string,
  onlyRunning = false
): Promise<ClickHouseRowsResult> {
  const filters = [`database = ${quoteString(config.database)}`]
  if (table?.trim()) {
    filters.push(`table = ${quoteString(stripDatabasePrefix(table))}`)
  }
  if (onlyRunning) {
    filters.push('is_done = 0')
  }
  return runSelect(
    config,
    `SELECT table, mutation_id AS mutationId, command, create_time AS createTime, is_done AS isDone, parts_to_do AS partsToDo, latest_fail_reason AS latestFailReason FROM system.mutations WHERE ${filters.join(' AND ')} ORDER BY create_time DESC FORMAT JSON`
  )
}

export function executeClickHouseListRunningQueries(
  config: ClickHouseConnectionConfig
): Promise<ClickHouseRowsResult> {
  return runSelect(
    config,
    'SELECT query_id AS queryId, user, toFloat64(elapsed) AS elapsedSeconds, formatReadableSize(memory_usage) AS memoryUsage, query FROM system.processes ORDER BY elapsed DESC FORMAT JSON'
  )
}

export function executeClickHouseTableStats(
  config: ClickHouseConnectionConfig,
  table?: string
): Promise<ClickHouseRowsResult> {
  const filters = ['active', `database = ${quoteString(config.database)}`]
  if (table?.trim()) {
    filters.push(`table = ${quoteString(stripDatabasePrefix(table))}`)
  }
  return runSelect(
    config,
    `SELECT database, table, sum(rows) AS rows, sum(bytes_on_disk) AS bytesOnDisk, formatReadableSize(sum(bytes_on_disk)) AS sizeOnDisk, count() AS parts FROM system.parts WHERE ${filters.join(' AND ')} GROUP BY database, table ORDER BY sum(bytes_on_disk) DESC FORMAT JSON`
  )
}

export function executeClickHouseListClusters(
  config: ClickHouseConnectionConfig
): Promise<ClickHouseRowsResult> {
  return runSelect(
    config,
    'SELECT cluster, shard_num AS shardNum, replica_num AS replicaNum, host_name AS hostName, port, is_local AS isLocal FROM system.clusters ORDER BY cluster, shard_num, replica_num FORMAT JSON'
  )
}

export async function executeClickHouseCreateDatabase(
  config: ClickHouseConnectionConfig,
  name: string
): Promise<void> {
  await clickhouseRequest(config, `CREATE DATABASE IF NOT EXISTS ${sanitizeIdentifier(name)}`)
}

export async function executeClickHouseDropDatabase(
  config: ClickHouseConnectionConfig,
  name: string
): Promise<void> {
  await clickhouseRequest(config, `DROP DATABASE IF EXISTS ${sanitizeIdentifier(name)}`)
}

/**
 * Validates a single ClickHouse column type. Types may legitimately contain
 * commas, single-quoted strings, `=`, and `-` inside their parameter parentheses
 * (e.g. `Decimal(10, 2)`, `Enum8('a' = 1, 'b' = -2)`, `Map(String, UInt64)`,
 * `Array(Tuple(a UInt8, b String))`). We allow those but reject anything that
 * could break out of the single type literal and inject another column or SQL:
 * comment/terminator sequences, a top-level (unparenthesised) comma, or an
 * unbalanced closing paren.
 */
function validateColumnType(type: string): void {
  const trimmed = type.trim()
  if (!trimmed || !/^[A-Za-z_]/.test(trimmed)) {
    throw new Error(`Invalid column type: ${type}`)
  }
  if (!/^[A-Za-z0-9_(),.\s'"=-]+$/.test(trimmed) || /--|;/.test(trimmed)) {
    throw new Error(`Invalid column type: ${type}`)
  }
  let depth = 0
  let inString = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === "'") inString = false
      continue
    }
    if (ch === "'") inString = true
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth < 0) throw new Error(`Invalid column type: ${type}`)
    } else if (ch === ',' && depth === 0) {
      throw new Error(`Invalid column type: ${type}`)
    }
  }
  if (inString || depth !== 0) {
    throw new Error(`Invalid column type: ${type}`)
  }
}

export async function executeClickHouseCreateTable(
  config: ClickHouseConnectionConfig,
  table: string,
  columns: Array<{ name: string; type: string }>,
  engine: string,
  orderBy: string,
  partitionBy?: string
): Promise<void> {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('At least one column definition is required')
  }

  const columnDefs = columns.map((column) => {
    if (!column?.name || !column?.type) {
      throw new Error('Each column requires a name and type')
    }
    validateColumnType(column.type)
    return `${sanitizeIdentifier(column.name)} ${column.type.trim()}`
  })

  if (!/^[A-Za-z][A-Za-z0-9]*(\(.*\))?$/.test(engine.trim())) {
    throw new Error(`Invalid table engine: ${engine}`)
  }
  validateExpression(engine, 'Engine')

  if (!orderBy?.trim()) {
    throw new Error('ORDER BY expression is required')
  }
  validateClauseExpression(orderBy, 'ORDER BY')

  let statement = `CREATE TABLE IF NOT EXISTS ${sanitizeIdentifier(table)} (${columnDefs.join(', ')}) ENGINE = ${engine.trim()}`
  if (partitionBy?.trim()) {
    validateClauseExpression(partitionBy, 'PARTITION BY')
    statement += ` PARTITION BY (${partitionBy.trim()})`
  }
  statement += ` ORDER BY (${orderBy.trim()})`

  await clickhouseRequest(config, statement)
}

export async function executeClickHouseDropTable(
  config: ClickHouseConnectionConfig,
  table: string
): Promise<void> {
  await clickhouseRequest(config, `DROP TABLE IF EXISTS ${sanitizeIdentifier(table)}`)
}

export async function executeClickHouseTruncateTable(
  config: ClickHouseConnectionConfig,
  table: string
): Promise<void> {
  await clickhouseRequest(config, `TRUNCATE TABLE IF EXISTS ${sanitizeIdentifier(table)}`)
}

export async function executeClickHouseRenameTable(
  config: ClickHouseConnectionConfig,
  fromTable: string,
  toTable: string
): Promise<void> {
  await clickhouseRequest(
    config,
    `RENAME TABLE ${sanitizeIdentifier(fromTable)} TO ${sanitizeIdentifier(toTable)}`
  )
}

export async function executeClickHouseOptimizeTable(
  config: ClickHouseConnectionConfig,
  table: string,
  final: boolean
): Promise<void> {
  await clickhouseRequest(
    config,
    `OPTIMIZE TABLE ${sanitizeIdentifier(table)}${final ? ' FINAL' : ''}`
  )
}

export async function executeClickHouseDropPartition(
  config: ClickHouseConnectionConfig,
  table: string,
  partition: string
): Promise<void> {
  validatePartitionExpression(partition)
  await clickhouseRequest(
    config,
    `ALTER TABLE ${sanitizeIdentifier(table)} DROP PARTITION ${partition.trim()}`
  )
}

export function executeClickHouseKillQuery(
  config: ClickHouseConnectionConfig,
  queryId: string
): Promise<ClickHouseRowsResult> {
  return runSelect(config, `KILL QUERY WHERE query_id = ${quoteString(queryId)} SYNC FORMAT JSON`)
}

export async function executeClickHouseInsertRows(
  config: ClickHouseConnectionConfig,
  table: string,
  rows: Array<Record<string, unknown>>
): Promise<ClickHouseRowsResult> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('At least one row is required')
  }
  const sanitizedTable = sanitizeIdentifier(table)
  const payload = rows.map((row) => JSON.stringify(row)).join('\n')
  const statement = `INSERT INTO ${sanitizedTable} FORMAT JSONEachRow\n${payload}`
  const written = await runStatement(config, statement)
  return { rows: [], rowCount: written || rows.length }
}

function stripDatabasePrefix(table: string): string {
  const parts = table.split('.')
  return parts[parts.length - 1].replace(/`/g, '')
}
