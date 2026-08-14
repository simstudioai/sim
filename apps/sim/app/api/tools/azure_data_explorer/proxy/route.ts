import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type AzureDataExplorerProxyRequest,
  assertSafeAzureDataExplorerClusterUri,
  azureDataExplorerProxyContract,
} from '@/lib/api/contracts/tools/azure_data_explorer'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('AzureDataExplorerProxyAPI')

const ENTRA_AUTHORITY = 'https://login.microsoftonline.com'
const OUTBOUND_FETCH_TIMEOUT_MS = 120_000
const TOKEN_FETCH_TIMEOUT_MS = 30_000
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000
const MAX_ERROR_MESSAGE_LENGTH = 2000
const MAX_TOKEN_RESPONSE_BYTES = 256 * 1024
/** Rows a single result may carry into a workflow value. */
const MAX_PROJECTED_ROWS = 10_000

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const TOKEN_CACHE = new Map<string, CachedToken>()

/** The cluster's own origin is the documented default token audience. */
function resolveResource(req: AzureDataExplorerProxyRequest, clusterUrl: URL): string {
  return (req.resource || clusterUrl.origin).replace(/\/+$/, '')
}

function tokenCacheKey(req: AzureDataExplorerProxyRequest, resource: string): string {
  const secretHash = createHash('sha256').update(req.clientSecret).digest('hex').slice(0, 16)
  return `${req.tenantId}::${req.clientId}::${secretHash}::${resource}`
}

function rememberToken(key: string, token: CachedToken): void {
  if (TOKEN_CACHE.has(key)) TOKEN_CACHE.delete(key)
  TOKEN_CACHE.set(key, token)
  while (TOKEN_CACHE.size > TOKEN_CACHE_MAX_ENTRIES) {
    const oldestKey = TOKEN_CACHE.keys().next().value
    if (oldestKey === undefined) break
    TOKEN_CACHE.delete(oldestKey)
  }
}

async function fetchAccessToken(
  req: AzureDataExplorerProxyRequest,
  resource: string,
  requestId: string
): Promise<string> {
  const cacheKey = tokenCacheKey(req, resource)
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return cached.accessToken
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: req.clientId,
    client_secret: req.clientSecret,
    resource,
  })

  const response = await secureFetchWithValidation(
    `${ENTRA_AUTHORITY}/${encodeURIComponent(req.tenantId)}/oauth2/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      timeout: TOKEN_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_TOKEN_RESPONSE_BYTES,
    },
    'tokenUrl'
  )

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn(`[${requestId}] Entra token fetch failed (${response.status}): ${text}`)
    throw new Error(
      `Microsoft Entra token request failed: HTTP ${response.status}. Verify tenantId, clientId, clientSecret, and that the app has access to the cluster.`
    )
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: string | number }
  if (!data.access_token) {
    throw new Error('Microsoft Entra token response did not include an access token')
  }

  const expiresInSeconds = Number(data.expires_in)
  const expiresInMs = (Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600) * 1000
  rememberToken(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  })
  return data.access_token
}

interface KustoColumn {
  ColumnName?: string
  DataType?: string
  ColumnType?: string
}

interface KustoTable {
  TableName?: string
  Columns?: KustoColumn[]
  Rows?: unknown[][]
}

function columnNames(table: KustoTable): string[] {
  return (table.Columns ?? []).map((column) => column.ColumnName ?? '')
}

/**
 * Picks the table holding the query's own results.
 *
 * A v1 query response carries several tables plus a trailing table of contents
 * that maps each ordinal to a kind; the first `QueryResult` ordinal is the
 * primary result. Management commands return a single table with no table of
 * contents, so the first table is the answer.
 */
function selectPrimaryTable(tables: KustoTable[]): KustoTable | null {
  if (tables.length === 0) return null

  const contents = tables[tables.length - 1]
  const names = columnNames(contents)
  const ordinalIndex = names.indexOf('Ordinal')
  const kindIndex = names.indexOf('Kind')

  if (ordinalIndex >= 0 && kindIndex >= 0) {
    for (const row of contents.Rows ?? []) {
      if (row[kindIndex] !== 'QueryResult') continue
      const ordinal = Number(row[ordinalIndex])
      if (Number.isInteger(ordinal) && tables[ordinal]) return tables[ordinal]
    }
  }

  return tables[0]
}

/**
 * Finds a partial query failure. Kusto answers 200 as soon as it starts
 * processing, then reports later failures through a QueryStatus table where a
 * severity of 2 or lower means the request did not succeed.
 */
function findQueryFailure(tables: KustoTable[]): string | null {
  for (const table of tables) {
    const names = columnNames(table)
    const severityIndex = names.indexOf('Severity')
    const descriptionIndex = names.indexOf('StatusDescription')
    if (severityIndex < 0 || descriptionIndex < 0) continue

    for (const row of table.Rows ?? []) {
      const severity = Number(row[severityIndex])
      if (!Number.isFinite(severity) || severity > 2) continue
      const description = row[descriptionIndex]
      return typeof description === 'string' && description.length > 0
        ? description
        : 'Kusto reported a query failure'
    }
  }
  return null
}

interface ProjectedTable {
  tableName: string | null
  columns: Array<{ name: string; type: string | null; dataType: string | null }>
  rows: unknown[][]
  records: Array<Record<string, unknown>>
  rowCount: number
  totalRowCount: number
  truncated: boolean
}

const EMPTY_PROJECTION: ProjectedTable = {
  tableName: null,
  columns: [],
  rows: [],
  records: [],
  rowCount: 0,
  totalRowCount: 0,
  truncated: false,
}

/**
 * Projects the result table into a bounded payload.
 *
 * Kusto's own result truncation is a request property the caller can raise or
 * disable, so neither the row count nor the byte count of a response is bounded
 * upstream. `MAX_PROJECTED_ROWS` is the ceiling on what a single workflow value
 * may carry; `truncated` tells the caller to narrow the query rather than
 * silently trusting a short answer.
 */
function projectTable(table: KustoTable | null): ProjectedTable {
  if (!table) return EMPTY_PROJECTION

  const columns = (table.Columns ?? []).map((column) => ({
    name: column.ColumnName ?? '',
    type: column.ColumnType ?? null,
    dataType: column.DataType ?? null,
  }))
  const allRows = table.Rows ?? []
  const rows = allRows.length > MAX_PROJECTED_ROWS ? allRows.slice(0, MAX_PROJECTED_ROWS) : allRows
  const records = rows.map((row) => {
    const record: Record<string, unknown> = {}
    columns.forEach((column, index) => {
      if (column.name) record[column.name] = row[index] ?? null
    })
    return record
  })

  return {
    tableName: table.TableName ?? null,
    columns,
    rows,
    records,
    rowCount: rows.length,
    totalRowCount: allRows.length,
    truncated: allRows.length > rows.length,
  }
}

/**
 * Kusto failures follow the Microsoft REST guidelines envelope, but a request
 * without a JSON body (or a gateway error) can answer with plain text.
 */
function extractKustoError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: { code?: unknown; message?: unknown } }).error
    if (error && typeof error === 'object') {
      const message = typeof error.message === 'string' ? error.message : ''
      const code = typeof error.code === 'string' ? error.code : ''
      if (message) return code ? `[${code}] ${message}` : message
      if (code) return code
    }
  }
  if (typeof body === 'string' && body.length > 0) {
    return truncate(body, MAX_ERROR_MESSAGE_LENGTH)
  }
  return `Azure Data Explorer request failed with HTTP ${status}`
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Azure Data Explorer request: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      azureDataExplorerProxyContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { success: false, error: getValidationErrorMessage(error, 'Validation failed') },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response
    const proxyReq = parsed.data.body

    const clusterUrl = assertSafeAzureDataExplorerClusterUri(proxyReq.clusterUri)
    const resource = resolveResource(proxyReq, clusterUrl)
    const accessToken = await fetchAccessToken(proxyReq, resource, requestId)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      'x-ms-client-request-id': `Sim.Workflow;${requestId}`,
      'x-ms-app': 'Sim',
    }
    if (proxyReq.readOnly) headers['x-ms-readonly'] = 'true'

    const response = await secureFetchWithValidation(
      `${clusterUrl.origin}/v1/rest/${proxyReq.endpoint}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...(proxyReq.database ? { db: proxyReq.database } : {}),
          csl: proxyReq.csl,
          ...(proxyReq.properties ? { properties: proxyReq.properties } : {}),
        }),
        timeout: OUTBOUND_FETCH_TIMEOUT_MS,
        maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      },
      'clusterUri'
    )

    const raw = await response.text()
    let body: unknown = null
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
    }

    if (!response.ok) {
      const message = extractKustoError(body, response.status)
      logger.warn(`[${requestId}] Azure Data Explorer error (${response.status}): ${message}`)
      return NextResponse.json(
        { success: false, error: message, status: response.status },
        { status: response.status }
      )
    }

    const tables = Array.isArray((body as { Tables?: KustoTable[] } | null)?.Tables)
      ? ((body as { Tables: KustoTable[] }).Tables ?? [])
      : []

    const failure = findQueryFailure(tables)
    if (failure) {
      logger.warn(`[${requestId}] Azure Data Explorer partial query failure: ${failure}`)
      return NextResponse.json(
        { success: false, error: truncate(failure, MAX_ERROR_MESSAGE_LENGTH), status: 200 },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      output: projectTable(selectPrimaryTable(tables)),
    })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      logger.warn(`[${requestId}] Azure Data Explorer response exceeded the size cap`)
      return NextResponse.json(
        {
          success: false,
          error:
            'The Azure Data Explorer response was too large to return. Narrow the query — add a `where` filter, aggregate with `summarize`, or bound it with `take` or `top N by`.',
        },
        { status: 413 }
      )
    }
    logger.error(`[${requestId}] Unexpected Azure Data Explorer proxy error:`, error)
    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
