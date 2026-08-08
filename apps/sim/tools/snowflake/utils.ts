import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  SnowflakeBaseParams,
  SnowflakeBinding,
  SnowflakeColumn,
  SnowflakeContextParams,
  SnowflakePartition,
  SnowflakeStatementOutput,
  SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import type { ToolConfig } from '@/tools/types'

export const DEFAULT_MAX_ROWS = 1_000
export const MAX_RESULT_ROWS = 10_000
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

const SNOWFLAKE_HOST_SUFFIXES = ['.snowflakecomputing.com', '.snowflakecomputing.cn']

interface SnowflakeApiColumn {
  name?: string
  type?: string
  length?: number | null
  precision?: number | null
  scale?: number | null
  nullable?: boolean
}

interface SnowflakeApiPartition {
  rowCount?: number
  compressedSize?: number
  uncompressedSize?: number
}

interface SnowflakeApiResponse {
  code?: string
  sqlState?: string
  message?: string
  statementHandle?: string
  data?: Array<Array<string | null>>
  resultSetMetaData?: {
    numRows?: number
    rowType?: SnowflakeApiColumn[]
    partitionInfo?: SnowflakeApiPartition[]
    stats?: {
      numRowsInserted?: number
      numRowsUpdated?: number
      numRowsDeleted?: number
      numDuplicateRowsUpdated?: number
    }
  }
}

interface SnowflakeDmlStats {
  rowsInserted?: number
  rowsUpdated?: number
  rowsDeleted?: number
  duplicateRowsUpdated?: number
}

type SnowflakeDmlStat = keyof SnowflakeDmlStats

const DML_RESULT_COLUMNS: Record<string, SnowflakeDmlStat> = {
  'number of rows inserted': 'rowsInserted',
  'number of rows updated': 'rowsUpdated',
  'number of rows deleted': 'rowsDeleted',
  'number of multi-joined rows updated': 'duplicateRowsUpdated',
  'number of duplicate rows updated': 'duplicateRowsUpdated',
}

const DML_RESULT_SHAPES = new Set([
  'rowsDeleted',
  'rowsInserted',
  'rowsUpdated',
  'duplicateRowsUpdated|rowsUpdated',
  'duplicateRowsUpdated|rowsInserted|rowsUpdated',
  'rowsInserted|rowsUpdated',
])

export interface SnowflakeStatementSpec {
  statement: string
  bindings?: Record<string, SnowflakeBinding>
}

type ToolParam = ToolConfig['params'][string]

export const snowflakeBaseParams = {
  host: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Snowflake account host, for example myorg-myaccount.snowflakecomputing.com',
  },
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Snowflake programmatic access token',
  },
} satisfies Record<string, ToolParam>

export const snowflakeContextParams = {
  warehouse: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Warehouse to use for this statement; defaults to the PAT user setting',
  },
  database: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Database context for this statement',
  },
  schema: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Schema context for this statement',
  },
  role: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Snowflake role to use for this statement',
  },
  timeout: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Statement timeout in seconds; 0 uses Snowflake maximum of 604800 seconds',
  },
  maxRows: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum result rows, from 1 to 10000; defaults to 1000',
  },
} satisfies Record<string, ToolParam>

export function normalizeSnowflakeHost(host: string): string {
  const raw = host.trim()
  if (!raw) throw new Error('Snowflake host is required')

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new Error('Invalid Snowflake account host')
  }

  if (url.protocol !== 'https:') throw new Error('Snowflake host must use HTTPS')
  if (url.href !== `https://${url.hostname}/`) {
    throw new Error('Snowflake host must contain only the account hostname')
  }

  const hostname = url.hostname.toLowerCase()
  if (!SNOWFLAKE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error('Snowflake host must be an official Snowflake account hostname')
  }
  return `https://${hostname}`
}

export function getSnowflakeHeaders(params: SnowflakeBaseParams): Record<string, string> {
  const apiKey = params.apiKey.trim()
  if (!apiKey) throw new Error('Snowflake programmatic access token is required')
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'sim-snowflake-integration/1.0',
    'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
  }
}

export function normalizeMaxRows(value?: number): number {
  const maxRows = value ?? DEFAULT_MAX_ROWS
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_RESULT_ROWS) {
    throw new Error(`maxRows must be an integer between 1 and ${MAX_RESULT_ROWS}`)
  }
  return maxRows
}

export function normalizeTimeout(value?: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < 0 || value > 604_800) {
    throw new Error('timeout must be an integer between 0 and 604800 seconds')
  }
  return value
}

function normalizeContextName(value: string): string {
  const trimmed = value.trim()
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(trimmed)) return trimmed.toUpperCase()
  if (/^"(?:[^"]|"")+"$/.test(trimmed)) {
    return trimmed.slice(1, -1).replaceAll('""', '"')
  }
  return trimmed
}

export function buildSnowflakeStatementBody(
  params: SnowflakeContextParams,
  spec: SnowflakeStatementSpec
): Record<string, unknown> {
  if (!/\S/.test(spec.statement)) throw new Error('Snowflake statement is required')

  const body: Record<string, unknown> = {
    statement: spec.statement,
    parameters: { rows_per_resultset: normalizeMaxRows(params.maxRows) },
  }
  const timeout = normalizeTimeout(params.timeout)
  if (timeout !== undefined) body.timeout = timeout
  if (params.warehouse?.trim()) body.warehouse = normalizeContextName(params.warehouse)
  if (params.database?.trim()) body.database = normalizeContextName(params.database)
  if (params.schema?.trim()) body.schema = normalizeContextName(params.schema)
  if (params.role?.trim()) body.role = normalizeContextName(params.role)
  if (spec.bindings && Object.keys(spec.bindings).length > 0) body.bindings = spec.bindings
  return body
}

function mapColumn(column: SnowflakeApiColumn): SnowflakeColumn {
  return {
    name: column.name ?? '',
    type: column.type ?? '',
    length: column.length ?? null,
    precision: column.precision ?? null,
    scale: column.scale ?? null,
    nullable: column.nullable ?? true,
  }
}

function mapPartition(partition: SnowflakeApiPartition): SnowflakePartition {
  return {
    rowCount: partition.rowCount ?? 0,
    compressedSize: partition.compressedSize ?? null,
    uncompressedSize: partition.uncompressedSize ?? 0,
  }
}

function normalizeResultColumnName(name?: string): string {
  return name?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
}

function parseRowCount(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || !/^[0-9]+$/.test(value.trim())) return undefined
  const count = Number(value)
  return Number.isSafeInteger(count) ? count : undefined
}

function deriveDmlStats(
  columns: SnowflakeApiColumn[],
  rows: Array<Array<string | null>>
): SnowflakeDmlStats {
  const columnNames = columns.map((column) => normalizeResultColumnName(column.name))
  const copyColumnIndexes = new Map(columnNames.map((name, index) => [name, index]))
  if (
    copyColumnIndexes.has('file') &&
    copyColumnIndexes.has('status') &&
    copyColumnIndexes.has('rows_loaded')
  ) {
    const rowsLoadedIndex = copyColumnIndexes.get('rows_loaded')
    if (rowsLoadedIndex === undefined) return {}
    let rowsInserted = 0
    let foundCount = false
    for (const row of rows) {
      const count = parseRowCount(row[rowsLoadedIndex])
      if (count === undefined) continue
      if (!Number.isSafeInteger(rowsInserted + count)) return {}
      rowsInserted += count
      foundCount = true
    }
    return foundCount ? { rowsInserted } : {}
  }

  if (rows.length !== 1) return {}
  const statColumns = columnNames.map((name) => DML_RESULT_COLUMNS[name])
  if (statColumns.some((column) => column === undefined)) return {}
  const shape = [...new Set(statColumns)].sort().join('|')
  if (!DML_RESULT_SHAPES.has(shape)) return {}

  const stats: SnowflakeDmlStats = {}
  for (const [index, stat] of statColumns.entries()) {
    if (!stat) continue
    const count = parseRowCount(rows[0][index])
    if (count !== undefined) stats[stat] = count
  }
  return stats
}

export async function transformSnowflakeResponse(
  response: Response,
  currentPartition = 0,
  requestedMaxRows = DEFAULT_MAX_ROWS,
  canceled = false,
  fallbackStatementHandle = ''
): Promise<SnowflakeStatementResponse> {
  const data = await readSnowflakeResponse(response)
  const pending = response.status === 202
  if (!response.ok && !pending) {
    throw new Error(
      data.message ||
        `Snowflake request failed with HTTP ${response.status}${data.code ? ` (${data.code})` : ''}`
    )
  }
  if (data.sqlState && data.sqlState !== '00000' && !canceled) {
    throw new Error(
      `Snowflake statement failed (SQLSTATE ${data.sqlState}${data.code ? `, ${data.code}` : ''}): ${data.message ?? 'Unknown error'}`
    )
  }

  const maxRows = normalizeMaxRows(requestedMaxRows)
  const sourceRows = data.data ?? []
  const rows = sourceRows.slice(0, maxRows)
  const columns = (data.resultSetMetaData?.rowType ?? []).map(mapColumn)
  const partitions = (data.resultSetMetaData?.partitionInfo ?? []).map(mapPartition)
  const partitionCount = partitions.length
  const linkedNextPartition = getLinkedPartition(response.headers.get('Link'), 'next')
  const nextPartition =
    linkedNextPartition ?? (currentPartition + 1 < partitionCount ? currentPartition + 1 : null)
  const stats = data.resultSetMetaData?.stats
  const derivedStats = deriveDmlStats(data.resultSetMetaData?.rowType ?? [], sourceRows)
  const rowsInserted = stats?.numRowsInserted ?? derivedStats.rowsInserted ?? 0
  const rowsUpdated = stats?.numRowsUpdated ?? derivedStats.rowsUpdated ?? 0
  const rowsDeleted = stats?.numRowsDeleted ?? derivedStats.rowsDeleted ?? 0
  const duplicateRowsUpdated =
    stats?.numDuplicateRowsUpdated ?? derivedStats.duplicateRowsUpdated ?? 0

  const output: SnowflakeStatementOutput = {
    statementHandle: data.statementHandle ?? fallbackStatementHandle,
    status: canceled ? 'CANCELED' : pending ? 'RUNNING' : 'SUCCEEDED',
    code: data.code ?? null,
    sqlState: data.sqlState ?? null,
    message: data.message ?? (pending ? 'Statement is still running' : 'Statement completed'),
    columns,
    rows,
    totalRows: data.resultSetMetaData?.numRows ?? null,
    partitions,
    currentPartition,
    nextPartition,
    truncated: data.code === '391908' || sourceRows.length > rows.length || nextPartition !== null,
    rowsInserted,
    rowsUpdated,
    rowsDeleted,
    duplicateRowsUpdated,
    rowsAffected: rowsInserted + rowsUpdated + rowsDeleted,
  }
  return { success: true, output }
}

async function readSnowflakeResponse(response: Response): Promise<SnowflakeApiResponse> {
  const text = await readResponseTextWithLimit(response, {
    maxBytes: MAX_RESPONSE_BYTES,
    label: 'Snowflake response',
  })
  if (!text) return {}
  try {
    return JSON.parse(text) as SnowflakeApiResponse
  } catch {
    throw new Error('Snowflake returned an invalid JSON response')
  }
}

function getLinkedPartition(linkHeader: string | null, relation: string): number | null {
  if (!linkHeader) return null
  for (const link of linkHeader.split(',')) {
    if (!new RegExp(`rel=["']?${relation}["']?`, 'i').test(link)) continue
    const match = link.match(/[?&]partition=([0-9]+)/i)
    if (match) return Number(match[1])
  }
  return null
}
