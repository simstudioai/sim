import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  type AzureDataExplorerInput,
  assertSafeAzureDataExplorerClusterUri,
  resolveEntraAuthority,
} from '@/lib/internal/azure-data-explorer/schema'
import type { AzureDataExplorerTable } from '@/tools/azure_data_explorer/types'

const logger = createLogger('AzureDataExplorerClient')

const OUTBOUND_FETCH_TIMEOUT_MS = 120_000
const TOKEN_FETCH_TIMEOUT_MS = 30_000
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000
const MAX_ERROR_MESSAGE_LENGTH = 2000
const MAX_TOKEN_RESPONSE_BYTES = 256 * 1024
const MAX_PROJECTED_ROWS = 10_000

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const TOKEN_CACHE = new Map<string, CachedToken>()

export class AzureDataExplorerOperationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerStatus?: number
  ) {
    super(message)
    this.name = 'AzureDataExplorerOperationError'
  }
}

function resolveResource(input: AzureDataExplorerInput, clusterUrl: URL): string {
  return (input.resource || clusterUrl.origin).replace(/\/+$/, '')
}

function tokenCacheKey(input: AzureDataExplorerInput, authority: string, resource: string): string {
  const secretHash = createHash('sha256').update(input.clientSecret).digest('hex').slice(0, 16)
  return `${authority}::${input.tenantId}::${input.clientId}::${secretHash}::${resource}`
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
  input: AzureDataExplorerInput,
  authority: string,
  resource: string,
  requestId: string,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const cacheKey = tokenCacheKey(input, authority, resource)
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return cached.accessToken
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: input.clientId,
    client_secret: input.clientSecret,
    resource,
  })

  const response = await secureFetchWithValidation(
    `${authority}/${encodeURIComponent(input.tenantId)}/oauth2/token`,
    {
      profile: 'configuredEndpoint',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      timeout: TOKEN_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_TOKEN_RESPONSE_BYTES,
      signal,
    },
    'tokenUrl'
  )
  signal?.throwIfAborted()

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn('Entra token fetch failed', { requestId, status: response.status, error: text })
    throw new AzureDataExplorerOperationError(
      `Microsoft Entra token request failed: HTTP ${response.status}. Verify tenantId, clientId, clientSecret, and that the app has access to the cluster.`,
      500
    )
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: string | number }
  if (!data.access_token) {
    throw new AzureDataExplorerOperationError(
      'Microsoft Entra token response did not include an access token',
      500
    )
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

interface TableOfContents {
  primaryOrdinal: number | null
  statusOrdinal: number | null
}

function readTableOfContents(tables: KustoTable[]): TableOfContents | null {
  if (tables.length === 0) return null
  const contents = tables[tables.length - 1]
  const names = columnNames(contents)
  const ordinalIndex = names.indexOf('Ordinal')
  const kindIndex = names.indexOf('Kind')
  if (ordinalIndex < 0 || kindIndex < 0) return null

  let primaryOrdinal: number | null = null
  let statusOrdinal: number | null = null
  for (const row of contents.Rows ?? []) {
    const ordinal = Number(row[ordinalIndex])
    if (!Number.isInteger(ordinal) || !tables[ordinal]) continue
    if (row[kindIndex] === 'QueryResult' && primaryOrdinal === null) primaryOrdinal = ordinal
    if (row[kindIndex] === 'QueryStatus' && statusOrdinal === null) statusOrdinal = ordinal
  }
  return { primaryOrdinal, statusOrdinal }
}

function selectPrimaryTable(
  tables: KustoTable[],
  contents: TableOfContents | null
): KustoTable | null {
  if (tables.length === 0) return null
  if (contents?.primaryOrdinal != null) return tables[contents.primaryOrdinal] ?? tables[0]
  return tables[0]
}

function findQueryFailure(tables: KustoTable[], contents: TableOfContents | null): string | null {
  if (contents?.statusOrdinal == null) return null
  const table = tables[contents.statusOrdinal]
  if (!table) return null
  const names = columnNames(table)
  const severityIndex = names.indexOf('Severity')
  const descriptionIndex = names.indexOf('StatusDescription')
  if (severityIndex < 0 || descriptionIndex < 0) return null

  for (const row of table.Rows ?? []) {
    const severity = Number(row[severityIndex])
    if (!Number.isFinite(severity) || severity > 2) continue
    const description = row[descriptionIndex]
    return typeof description === 'string' && description.length > 0
      ? description
      : 'Kusto reported a query failure'
  }
  return null
}

const EMPTY_PROJECTION: AzureDataExplorerTable = {
  tableName: null,
  columns: [],
  rows: [],
  records: [],
  rowCount: 0,
  totalRowCount: 0,
  truncated: false,
}

function projectTable(table: KustoTable | null): AzureDataExplorerTable {
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

export async function requestAzureDataExplorer(
  input: AzureDataExplorerInput,
  requestId: string,
  signal?: AbortSignal
): Promise<AzureDataExplorerTable> {
  signal?.throwIfAborted()
  const clusterUrl = assertSafeAzureDataExplorerClusterUri(input.clusterUri)
  const resource = resolveResource(input, clusterUrl)
  const authority = resolveEntraAuthority(clusterUrl.hostname)
  const accessToken = await fetchAccessToken(input, authority, resource, requestId, signal)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    'x-ms-client-request-id': `Sim.Workflow;${requestId}`,
    'x-ms-app': 'Sim',
  }
  if (input.readOnly) headers['x-ms-readonly'] = 'true'

  const response = await secureFetchWithValidation(
    `${clusterUrl.origin}/v1/rest/${input.endpoint}`,
    {
      profile: 'configuredEndpoint',
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(input.database ? { db: input.database } : {}),
        csl: input.csl,
        ...(input.properties ? { properties: input.properties } : {}),
      }),
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
    },
    'clusterUri'
  ).catch((error: unknown) => {
    if (isPayloadSizeLimitError(error)) {
      throw new AzureDataExplorerOperationError(
        'The Azure Data Explorer response was too large to return. Narrow the query — add a `where` filter, aggregate with `summarize`, or bound it with `take` or `top N by`.',
        413
      )
    }
    throw error
  })
  signal?.throwIfAborted()

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
    throw new AzureDataExplorerOperationError(
      extractKustoError(body, response.status),
      response.status,
      response.status
    )
  }

  const tables = Array.isArray((body as { Tables?: KustoTable[] } | null)?.Tables)
    ? ((body as { Tables: KustoTable[] }).Tables ?? [])
    : []
  const contents = readTableOfContents(tables)
  const failure = findQueryFailure(tables, contents)
  if (failure) {
    throw new AzureDataExplorerOperationError(truncate(failure, MAX_ERROR_MESSAGE_LENGTH), 400, 200)
  }
  return projectTable(selectPrimaryTable(tables, contents))
}
