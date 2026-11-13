import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  MicrosoftAppCredentialError,
  resolveMicrosoftAppResourceToken,
} from '@/lib/credentials/microsoft-app-service-account.server'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import {
  type AzureDataExplorerInput,
  type AzureDataExplorerRequest,
  assertSafeAzureDataExplorerClusterUri,
  kustoCredentialClouds,
  resolveEntraAuthority,
} from '@/lib/internal/azure-data-explorer/schema'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'
import type {
  AzureDataExplorerResultTable,
  AzureDataExplorerTable,
} from '@/tools/azure_data_explorer/types'

const logger = createLogger('AzureDataExplorerClient')

const OUTBOUND_FETCH_TIMEOUT_MS = 120_000
const TOKEN_FETCH_TIMEOUT_MS = 30_000
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000
const MAX_ERROR_MESSAGE_LENGTH = 2000
const MAX_TOKEN_RESPONSE_BYTES = 256 * 1024
const MAX_PROJECTED_ROWS = 10_000
/**
 * Serialized bytes the projected tables may take together. The projection carries each row twice
 * (positional and keyed), so it is bounded by the inline tool response cap, minus each table's
 * actual envelope and a small margin for the response wrapper, rather than left to fail there
 * with a generic size error.
 */
const MAX_PROJECTED_BYTES = MAX_TOOL_RESPONSE_BODY_BYTES - 16 * 1024

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

function resolveResource(input: AzureDataExplorerRequest, clusterUrl: URL): string {
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
  /** Ordinals of every QueryResult table, in order; batches and `fork` produce more than one. */
  resultOrdinals: number[]
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
  const resultOrdinals: number[] = []
  for (const row of contents.Rows ?? []) {
    const ordinal = Number(row[ordinalIndex])
    if (!Number.isInteger(ordinal) || !tables[ordinal]) continue
    if (row[kindIndex] === 'QueryResult') {
      if (primaryOrdinal === null) primaryOrdinal = ordinal
      resultOrdinals.push(ordinal)
    }
    if (row[kindIndex] === 'QueryStatus' && statusOrdinal === null) statusOrdinal = ordinal
  }
  return { primaryOrdinal, statusOrdinal, resultOrdinals }
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

const EMPTY_PROJECTION: AzureDataExplorerResultTable = {
  tableName: null,
  columns: [],
  rows: [],
  records: [],
  rowCount: 0,
  totalRowCount: 0,
  truncated: false,
}

interface ProjectionBudget {
  rows: number
  bytes: number
}

function projectColumns(table: KustoTable): AzureDataExplorerResultTable['columns'] {
  return (table.Columns ?? []).map((column) => ({
    name: column.ColumnName ?? '',
    type: column.ColumnType ?? null,
    dataType: column.DataType ?? null,
  }))
}

/** Serialized size of a table's projection without its rows, reserved before any rows are kept. */
function envelopeBytes(table: KustoTable | null): number {
  if (!table) return Buffer.byteLength(JSON.stringify(EMPTY_PROJECTION))
  const rowTotal = (table.Rows ?? []).length
  return Buffer.byteLength(
    JSON.stringify({
      tableName: table.TableName ?? null,
      columns: projectColumns(table),
      rows: [],
      records: [],
      rowCount: rowTotal,
      totalRowCount: rowTotal,
      truncated: false,
    })
  )
}

function projectTable(
  table: KustoTable | null,
  budget: ProjectionBudget
): AzureDataExplorerResultTable {
  if (!table) return EMPTY_PROJECTION
  const columns = projectColumns(table)
  const allRows = table.Rows ?? []
  const rows: unknown[][] = []
  const records: Array<Record<string, unknown>> = []
  for (const row of allRows) {
    if (budget.rows <= 0) break
    const record: Record<string, unknown> = {}
    columns.forEach((column, index) => {
      if (column.name) record[column.name] = row[index] ?? null
    })
    const bytes =
      Buffer.byteLength(JSON.stringify(row)) + Buffer.byteLength(JSON.stringify(record)) + 2
    if (bytes > budget.bytes) {
      budget.rows = 0
      break
    }
    budget.rows -= 1
    budget.bytes -= bytes
    rows.push(row)
    records.push(record)
  }
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

function projectResults(
  tables: KustoTable[],
  contents: TableOfContents | null
): AzureDataExplorerTable {
  const primaryTable = selectPrimaryTable(tables, contents)
  const additionalOrdinals = contents?.resultOrdinals.slice(1) ?? []
  const reserved = [primaryTable, ...additionalOrdinals.map((ordinal) => tables[ordinal] ?? null)]
    .map(envelopeBytes)
    .reduce((total, bytes) => total + bytes, 0)
  const budget: ProjectionBudget = {
    rows: MAX_PROJECTED_ROWS,
    bytes: MAX_PROJECTED_BYTES - reserved,
  }
  const primary = projectTable(primaryTable, budget)
  if (additionalOrdinals.length === 0) return primary
  return {
    ...primary,
    additionalResults: additionalOrdinals.map((ordinal) => projectTable(tables[ordinal], budget)),
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

/** Signs a request in with the inline client secret it carries. */
export async function requestAzureDataExplorer(
  input: AzureDataExplorerInput,
  requestId: string,
  signal?: AbortSignal
): Promise<AzureDataExplorerTable> {
  return sendAzureDataExplorerRequest(
    input,
    (clusterUrl) =>
      fetchAccessToken(
        input,
        resolveEntraAuthority(clusterUrl.hostname),
        resolveResource(input, clusterUrl),
        requestId,
        signal
      ),
    requestId,
    signal
  )
}

/** What a tool caller is told when the Microsoft app credential cannot be used, by refusal code. */
function appCredentialRefusal(error: TokenServiceAccountValidationError) {
  switch (error.code) {
    case 'provider_unavailable':
      return new AzureDataExplorerOperationError(
        'Microsoft Entra is temporarily unavailable; try again in a moment',
        503
      )
    case 'cloud_mismatch':
      return new AzureDataExplorerOperationError(
        'The Microsoft app credential signs in to a different Microsoft cloud than this cluster; choose a credential registered in the cluster’s cloud',
        400
      )
    default:
      return new AzureDataExplorerOperationError(
        'Microsoft Entra rejected the Microsoft app credential; check the app registration and reconnect the credential',
        403
      )
  }
}

/**
 * Runs a request as an executor-authorized Microsoft app credential that belongs to `scope`, the
 * run's own workspace or organization. The token audience is the allowlisted host of the
 * `resource` override or of the cluster, as `https://<host>` (Kusto's documented resource ID, the
 * cluster URI without port or path), and both that host and the cluster must be in the
 * credential's cloud.
 * @see https://learn.microsoft.com/en-us/kusto/api/rest/authenticate-with-msal
 */
export async function requestAzureDataExplorerAsApp(
  input: AzureDataExplorerRequest,
  credential: { credentialId: string; scope: { workspaceId?: string; organizationId?: string } },
  requestId: string,
  signal?: AbortSignal
): Promise<AzureDataExplorerTable> {
  return sendAzureDataExplorerRequest(
    input,
    async (clusterUrl) => {
      const audienceHost = input.resource
        ? assertSafeAzureDataExplorerClusterUri(input.resource, 'resource').hostname
        : clusterUrl.hostname
      const clusterClouds = kustoCredentialClouds(clusterUrl.hostname)
      try {
        return await resolveMicrosoftAppResourceToken(
          credential.credentialId,
          credential.scope,
          {
            resource: `https://${audienceHost.toLowerCase()}`,
            clouds: kustoCredentialClouds(audienceHost).filter((cloud) =>
              clusterClouds.includes(cloud)
            ),
            serviceLabel: 'Azure Data Explorer',
          },
          signal
        )
      } catch (error) {
        if (error instanceof MicrosoftAppCredentialError) {
          throw new AzureDataExplorerOperationError(error.message, 403)
        }
        if (!(error instanceof TokenServiceAccountValidationError)) throw error
        logger.warn('Microsoft app credential refused for Azure Data Explorer', {
          requestId,
          code: error.code,
          ...error.logDetail,
        })
        throw appCredentialRefusal(error)
      }
    },
    requestId,
    signal
  )
}

async function sendAzureDataExplorerRequest(
  input: AzureDataExplorerRequest,
  getAccessToken: (clusterUrl: URL) => Promise<string>,
  requestId: string,
  signal?: AbortSignal
): Promise<AzureDataExplorerTable> {
  signal?.throwIfAborted()
  const clusterUrl = assertSafeAzureDataExplorerClusterUri(input.clusterUri)
  const accessToken = await getAccessToken(clusterUrl)
  signal?.throwIfAborted()

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
  return projectResults(tables, contents)
}
