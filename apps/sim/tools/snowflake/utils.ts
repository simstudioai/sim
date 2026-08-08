import { isPlainRecord } from '@sim/utils/object'
import type {
  SnowflakeBaseParams,
  SnowflakeBinding,
  SnowflakeColumn,
  SnowflakeDmlStats,
  SnowflakeResultOutput,
  SnowflakeStatementOutput,
  SnowflakeStatementParams,
  SnowflakeStatementResponse,
  SnowflakeStatementStatus,
} from '@/tools/snowflake/types'
import type { ToolConfig } from '@/tools/types'

export const DEFAULT_MAX_ROWS = 1_000
export const SIM_MAX_RESULT_ROWS = 10_000

const SNOWFLAKE_HOST_SUFFIXES = ['.snowflakecomputing.com', '.snowflakecomputing.cn']

interface SnowflakeApiColumn {
  name?: string
  type?: string
  length?: number | null
  precision?: number | null
  scale?: number | null
  nullable?: boolean
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
    partitionInfo?: unknown[]
    stats?: {
      numRowsInserted?: number
      numRowsUpdated?: number
      numRowsDeleted?: number
      numDuplicateRowsUpdated?: number
    }
  }
}

export interface SnowflakeStatementSpec {
  statement: string
  bindings?: Record<string, SnowflakeBinding>
}

interface SnowflakeResponseOptions {
  currentPartition?: number
  canceled?: boolean
  fallbackStatementHandle?: string
}

interface SnowflakeStatementBodyOptions {
  context?: {
    database?: string
    schema?: string
  }
  warehouse?: string
  maxRows?: number
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

export const snowflakeStatementParams = {
  role: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Snowflake role to use for this statement',
  },
  statementTimeoutSeconds: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Statement timeout in seconds; 0 uses Snowflake maximum of 604800 seconds',
  },
} satisfies Record<string, ToolParam>

export const snowflakeComputeParams = {
  ...snowflakeStatementParams,
  warehouse: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Warehouse to use for this statement; defaults to the PAT user setting',
  },
} satisfies Record<string, ToolParam>

export const snowflakeMaxRowsParam = {
  maxRows: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum result rows; defaults to 1000 with a Sim safety limit of 10000',
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
    'User-Agent': 'Sim/1.0 (+https://sim.ai)',
    'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
  }
}

export function snowflakeStatementRequest<P extends SnowflakeBaseParams>(
  body: (params: P) => Record<string, unknown>,
  asynchronous?: (params: P) => boolean
): ToolConfig<P>['request'] {
  return {
    url: (params) =>
      `${normalizeSnowflakeHost(params.host)}/api/v2/statements${asynchronous?.(params) ? '?async=true' : ''}`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body,
  }
}

export function normalizeMaxRows(value?: number): number {
  const maxRows = value ?? DEFAULT_MAX_ROWS
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > SIM_MAX_RESULT_ROWS) {
    throw new Error(
      `maxRows must be an integer between 1 and the Sim safety limit of ${SIM_MAX_RESULT_ROWS}`
    )
  }
  return maxRows
}

export function normalizeStatementTimeout(value?: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < 0 || value > 604_800) {
    throw new Error('statementTimeoutSeconds must be an integer between 0 and 604800 seconds')
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
  params: SnowflakeStatementParams,
  spec: SnowflakeStatementSpec,
  options: SnowflakeStatementBodyOptions = {}
): Record<string, unknown> {
  if (!/\S/.test(spec.statement)) throw new Error('Snowflake statement is required')

  const body: Record<string, unknown> = {
    statement: spec.statement,
    parameters: { rows_per_resultset: normalizeMaxRows(options.maxRows) },
  }
  const statementTimeoutSeconds = normalizeStatementTimeout(params.statementTimeoutSeconds)
  if (statementTimeoutSeconds !== undefined) body.timeout = statementTimeoutSeconds
  if (options.warehouse?.trim()) body.warehouse = normalizeContextName(options.warehouse)
  if (options.context?.database?.trim()) {
    body.database = normalizeContextName(options.context.database)
  }
  if (options.context?.schema?.trim()) body.schema = normalizeContextName(options.context.schema)
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

export async function readSnowflakeResult(
  response: Response,
  options: SnowflakeResponseOptions = {}
): Promise<SnowflakeStatementOutput> {
  const data = await readSnowflakeJson(response)
  const pending = response.status === 202
  const successfulSqlStates = options.canceled ? ['', '00000', '57014'] : ['', '00000']
  if (data.sqlState !== undefined && !successfulSqlStates.includes(data.sqlState)) {
    throw new Error(
      `Snowflake statement failed (SQLSTATE ${data.sqlState}${data.code ? `, ${data.code}` : ''}): ${data.message ?? 'Unknown error'}`
    )
  }

  const statementHandle = (data.statementHandle ?? options.fallbackStatementHandle ?? '').trim()
  if (pending && !statementHandle) {
    throw new Error('Snowflake returned a running statement without a statement handle')
  }

  const canceled = options.canceled === true
  const hasResult =
    !pending && !canceled && (data.resultSetMetaData !== undefined || data.data !== undefined)
  const result = hasResult ? buildResultOutput(data, response, options.currentPartition ?? 0) : null
  const stats = data.resultSetMetaData?.stats
  const dml = !pending && !canceled && stats ? buildDmlStats(stats) : null

  return {
    statementHandle,
    status: statementStatus(pending, canceled),
    message: data.message ?? null,
    result,
    dml,
  }
}

export function transformSnowflakeResult<P extends SnowflakeBaseParams>(
  options?: (params?: P) => SnowflakeResponseOptions
): (response: Response, params?: P) => Promise<SnowflakeStatementResponse> {
  return async (response, params) => ({
    success: true,
    output: await readSnowflakeResult(response, options?.(params)),
  })
}

async function readSnowflakeJson(response: Response): Promise<SnowflakeApiResponse> {
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('Snowflake returned an invalid JSON response')
  }
  if (!isPlainRecord(data)) throw new Error('Snowflake returned an invalid JSON response')
  return data as SnowflakeApiResponse
}

function statementStatus(pending: boolean, canceled: boolean): SnowflakeStatementStatus {
  if (canceled) return 'CANCELED'
  return pending ? 'RUNNING' : 'SUCCEEDED'
}

function buildResultOutput(
  data: SnowflakeApiResponse,
  response: Response,
  currentPartition: number
): SnowflakeResultOutput {
  const partitionCount = data.resultSetMetaData?.partitionInfo?.length ?? 0
  const linkedNextPartition = getLinkedPartition(response.headers.get('Link'), 'next')
  const nextPartition =
    linkedNextPartition ?? (currentPartition + 1 < partitionCount ? currentPartition + 1 : null)
  return {
    columns: (data.resultSetMetaData?.rowType ?? []).map(mapColumn),
    rows: data.data ?? [],
    totalRows: data.resultSetMetaData?.numRows ?? null,
    currentPartition,
    nextPartition,
    truncated: data.code === '391908' || nextPartition !== null,
  }
}

function buildDmlStats(
  stats: NonNullable<SnowflakeApiResponse['resultSetMetaData']>['stats']
): SnowflakeDmlStats {
  const rowsInserted = stats?.numRowsInserted ?? 0
  const rowsUpdated = stats?.numRowsUpdated ?? 0
  const rowsDeleted = stats?.numRowsDeleted ?? 0
  return {
    rowsInserted,
    rowsUpdated,
    rowsDeleted,
    duplicateRowsUpdated: stats?.numDuplicateRowsUpdated ?? 0,
    rowsAffected: rowsInserted + rowsUpdated + rowsDeleted,
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
