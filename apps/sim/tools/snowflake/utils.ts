import { isPlainRecord } from '@sim/utils/object'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
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

/**
 * Byte ceiling for a single Snowflake SQL API response body. Get Statement can
 * fetch an arbitrary partition of a result set Sim never submitted, so no
 * Sim-side row cap bounds the payload.
 *
 * Matches `MAX_HTTP_RESPONSE_BODY_BYTES` in `@/tools/http/request`. Rows are
 * emitted verbatim into workflow state and logs, and the nearest real ceiling
 * downstream is the 6 MiB function-context budget in `@/executor/variables/resolver`,
 * so a bigger limit here only converts an explicit error into an opaque failure
 * later. The largest partition in Snowflake's own documented example is under
 * 0.5 MB. Reduce `maxRows` on the submitting statement to keep partitions
 * under the limit.
 */
export const SNOWFLAKE_MAX_RESPONSE_BYTES = 10 * 1024 * 1024

const SNOWFLAKE_HOST_SUFFIXES = ['.snowflakecomputing.com', '.snowflakecomputing.cn']

/** SQLSTATE values Snowflake returns for a statement that completed normally. */
const SNOWFLAKE_SUCCESS_SQL_STATES = ['', '00000']

/** SQLSTATE/code the Cancel Statement endpoint returns for an actual cancellation. */
const SNOWFLAKE_CANCELED_SQL_STATE = '57014'
const SNOWFLAKE_CANCELED_CODE = '000604'

interface SnowflakeApiColumn {
  name?: string
  type?: string
  length?: number | null
  precision?: number | null
  scale?: number | null
  nullable?: boolean
}

interface SnowflakeApiPartitionInfo {
  rowCount?: number
  uncompressedSize?: number
  compressedSize?: number
}

interface SnowflakeApiStats {
  numRowsInserted?: number
  numRowsUpdated?: number
  numRowsDeleted?: number
  numDuplicateRowsUpdated?: number
}

interface SnowflakeApiResponse {
  code?: string
  sqlState?: string
  message?: string
  statementHandle?: string
  data?: Array<Array<string | null>>
  /**
   * The SQL API reference declares `stats` as a direct property of the ResultSet
   * object, and also describes it under `resultSetMetaData`. Snowflake's own docs
   * are inconsistent here, so both shapes are read with the top-level one winning.
   */
  stats?: SnowflakeApiStats
  resultSetMetaData?: {
    numRows?: number
    format?: string
    rowType?: SnowflakeApiColumn[]
    partitionInfo?: SnowflakeApiPartitionInfo[]
    stats?: SnowflakeApiStats
  }
}

export interface SnowflakeStatementSpec {
  statement: string
  bindings?: Record<string, SnowflakeBinding>
}

interface SnowflakeResponseOptions {
  currentPartition?: number
  /**
   * Total partition count carried forward from the first partition, which is
   * the only response Snowflake attaches result metadata to.
   */
  partitionCount?: number
  canceled?: boolean
  fallbackStatementHandle?: string
  signal?: AbortSignal
  /** Remaining decoded response bytes available to a multi-response consumer. */
  byteBudget?: { remainingBytes: number }
}

interface SnowflakeStatementBodyOptions {
  context?: {
    database?: string
    schema?: string
  }
  warehouse?: string
  maxRows?: number
}

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

/**
 * Auth params every Snowflake tool declares. The account host and the
 * programmatic access token both live on the selected credential, so the block
 * collects neither: `accessToken` and `domain` are injected by the executor
 * when it resolves `credential`.
 */
export const snowflakeAuthParamFields = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Snowflake credential (account host and programmatic access token)',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Programmatic access token injected by the executor from the selected credential',
  },
  domain: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Snowflake account host injected by the executor from the selected credential',
  },
} satisfies ToolConfig['params']

/**
 * Header set every Snowflake SQL API request carries. Shared with the
 * credential validator in
 * `@/lib/credentials/token-service-accounts/validators/snowflake` so a token
 * that verifies at connect time is proven against the exact header shape the
 * tools use at run time.
 */
export function buildSnowflakeAuthHeaders(accessToken: string): Record<string, string> {
  const token = accessToken.trim()
  if (!token) throw new Error('Snowflake programmatic access token is required')
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Sim/1.0 (+https://sim.ai)',
    'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
  }
}

export function getSnowflakeHeaders(params: SnowflakeBaseParams): Record<string, string> {
  if (!params.accessToken) {
    throw new Error('No Snowflake credential is selected, or it could not be resolved')
  }
  return buildSnowflakeAuthHeaders(params.accessToken)
}

/**
 * Account host for the selected credential. The host is stored on the
 * credential rather than entered per block, so a missing value means the
 * credential failed to resolve — not that the user left a field blank.
 */
export function getSnowflakeBaseUrl(params: SnowflakeBaseParams): string {
  if (!params.domain) {
    throw new Error('No Snowflake credential is selected, or it could not be resolved')
  }
  return normalizeSnowflakeHost(params.domain)
}

export function snowflakeStatementRequest<P extends SnowflakeBaseParams>(
  body: (params: P) => Record<string, unknown>,
  asynchronous?: (params: P) => boolean
): ToolConfig<P>['request'] {
  return {
    url: (params) =>
      `${getSnowflakeBaseUrl(params)}/api/v2/statements${asynchronous?.(params) ? '?async=true' : ''}`,
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

/**
 * Resolves a Snowflake session-context identifier to the literal name the SQL
 * API expects in `role`/`warehouse`/`database`/`schema`. Input that is neither
 * a bare identifier nor a double-quoted identifier is rejected rather than
 * forwarded verbatim, keeping this fail-closed like the rest of the transport.
 */
function normalizeContextName(value: string, field: string): string {
  const trimmed = value.trim()
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(trimmed)) return trimmed.toUpperCase()
  if (/^"(?:[^"]|"")+"$/.test(trimmed)) {
    return trimmed.slice(1, -1).replaceAll('""', '"')
  }
  throw new Error(`Snowflake ${field} must be an unquoted identifier or a double-quoted identifier`)
}

/**
 * Builds the `/api/v2/statements` request body.
 *
 * `parameters.rows_per_resultset` caps the result set server-side. Snowflake
 * emits no response field indicating the cap was applied, so a capped `SELECT`
 * is indistinguishable from one that genuinely matched that many rows — the
 * result's `truncated` flag reports remaining partitions only and never this cap.
 */
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
  if (options.warehouse?.trim())
    body.warehouse = normalizeContextName(options.warehouse, 'warehouse')
  if (options.context?.database?.trim()) {
    body.database = normalizeContextName(options.context.database, 'database')
  }
  if (options.context?.schema?.trim()) {
    body.schema = normalizeContextName(options.context.schema, 'schema')
  }
  if (params.role?.trim()) body.role = normalizeContextName(params.role, 'role')
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
  const data = await readSnowflakeJson(response, options)
  const pending = response.status === 202
  const cancelRequest = options.canceled === true
  assertSnowflakeSuccess(response, data, cancelRequest)

  const statementHandle = (data.statementHandle ?? options.fallbackStatementHandle ?? '').trim()
  if (pending && !statementHandle) {
    throw new Error('Snowflake returned a running statement without a statement handle')
  }

  const canceled = cancelRequest && isCanceledResponse(data)
  const hasResult =
    !pending && !canceled && (data.resultSetMetaData !== undefined || data.data !== undefined)
  const result = hasResult
    ? buildResultOutput(data, options.currentPartition ?? 0, options.partitionCount)
    : null
  const stats = data.stats ?? data.resultSetMetaData?.stats
  const dml = !pending && !canceled && stats ? buildDmlStats(stats) : null

  return {
    statementHandle,
    status: statementStatus(pending, canceled),
    message: data.message ?? null,
    result,
    dml,
  }
}

/**
 * A Snowflake body is a success only when the HTTP status is 2xx *and* any
 * SQLSTATE it carries is a successful one. Both must hold: a body without
 * `sqlState` must not be read as a completed statement on an error status, and
 * a successful `sqlState` must not launder an error status either — HTTP 408
 * ("the execution of the statement exceeded the timeout period ... was
 * cancelled") returns a QueryStatus body, and every documented success body is
 * 200 or 202, so requiring both rejects nothing valid.
 */
function assertSnowflakeSuccess(
  response: Response,
  data: SnowflakeApiResponse,
  cancelRequest: boolean
): void {
  const successfulSqlStates = cancelRequest
    ? [...SNOWFLAKE_SUCCESS_SQL_STATES, SNOWFLAKE_CANCELED_SQL_STATE]
    : SNOWFLAKE_SUCCESS_SQL_STATES
  const failed =
    !response.ok || (data.sqlState !== undefined && !successfulSqlStates.includes(data.sqlState))
  if (!failed) return

  const descriptor = [
    `HTTP ${response.status}`,
    data.sqlState === undefined ? undefined : `SQLSTATE ${data.sqlState}`,
    data.code,
  ]
    .filter(Boolean)
    .join(', ')
  throw new Error(`Snowflake statement failed (${descriptor}): ${data.message ?? 'Unknown error'}`)
}

/**
 * Cancel Statement reports SQLSTATE 57014 / code 000604 only when it actually
 * canceled the statement; a successful SQLSTATE means it had already finished.
 */
function isCanceledResponse(data: SnowflakeApiResponse): boolean {
  return data.sqlState === SNOWFLAKE_CANCELED_SQL_STATE || data.code === SNOWFLAKE_CANCELED_CODE
}

export function transformSnowflakeResult<P extends SnowflakeBaseParams>(
  options?: (params?: P) => SnowflakeResponseOptions
): (response: Response, params?: P) => Promise<SnowflakeStatementResponse> {
  return async (response, params) => ({
    success: true,
    output: await readSnowflakeResult(response, options?.(params)),
  })
}

async function readSnowflakeJson(
  response: Response,
  options: Pick<SnowflakeResponseOptions, 'byteBudget' | 'signal'>
): Promise<SnowflakeApiResponse> {
  const remainingBytes = options.byteBudget?.remainingBytes ?? SNOWFLAKE_MAX_RESPONSE_BYTES
  if (!Number.isSafeInteger(remainingBytes) || remainingBytes < 0) {
    throw new Error('Snowflake response byte budget is invalid')
  }
  const body = await readResponseTextWithLimit(response, {
    maxBytes: Math.min(SNOWFLAKE_MAX_RESPONSE_BYTES, remainingBytes),
    label: 'Snowflake response body',
    signal: options.signal,
  })
  if (options.byteBudget) options.byteBudget.remainingBytes -= Buffer.byteLength(body)
  let data: unknown
  try {
    data = JSON.parse(body)
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

/**
 * `/api/v2/statements` pages exclusively through the `partition` query parameter
 * and `resultSetMetaData.partitionInfo`. The `Link` response header and the
 * `391908` truncated-result code belong to the retired `/api/statements` API and
 * are never emitted here, so neither is consulted.
 *
 * Snowflake documents that partition responses after the first "do not contain
 * any metadata" and that "metadata for all partitions is provided in the first
 * partition". A later partition therefore carries no continuation signal of its
 * own: unless the caller passes the partition count forward from partition 0,
 * completeness and column metadata are unknown and are reported as `null`
 * rather than asserted as a complete, column-less result.
 */
function buildResultOutput(
  data: SnowflakeApiResponse,
  currentPartition: number,
  knownPartitionCount?: number
): SnowflakeResultOutput {
  const metadata = data.resultSetMetaData
  const partitionCount = metadata?.partitionInfo?.length ?? knownPartitionCount ?? null
  const nextPartition =
    partitionCount !== null && currentPartition + 1 < partitionCount ? currentPartition + 1 : null
  const completenessKnown = partitionCount !== null || currentPartition === 0
  return {
    columns:
      metadata === undefined && currentPartition > 0
        ? null
        : (metadata?.rowType ?? []).map(mapColumn),
    rows: data.data ?? [],
    totalRows: metadata?.numRows ?? null,
    currentPartition,
    partitionCount,
    nextPartition,
    truncated: completenessKnown ? nextPartition !== null : null,
  }
}

function buildDmlStats(stats: SnowflakeApiStats): SnowflakeDmlStats {
  const rowsInserted = stats.numRowsInserted ?? 0
  const rowsUpdated = stats.numRowsUpdated ?? 0
  const rowsDeleted = stats.numRowsDeleted ?? 0
  return {
    rowsInserted,
    rowsUpdated,
    rowsDeleted,
    duplicateRowsUpdated: stats.numDuplicateRowsUpdated ?? 0,
    rowsAffected: rowsInserted + rowsUpdated + rowsDeleted,
  }
}
