import { isIP } from 'node:net'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateDatabaseHost,
} from '@/lib/core/security/input-validation.server'

const REQUEST_TIMEOUT_MS = 30_000

export interface ClickHouseConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  secure: boolean
}

interface ClickHouseSummary {
  read_rows?: string
  written_rows?: string
  result_rows?: string
}

export interface ClickHouseHttpResult {
  text: string
  summary: ClickHouseSummary | null
}

export interface ClickHouseRequestOptions {
  readOnly?: boolean
  signal?: AbortSignal
}

function parseSummary(header: string | null): ClickHouseSummary | null {
  if (!header) return null
  try {
    return JSON.parse(header) as ClickHouseSummary
  } catch {
    return null
  }
}

function formatUrlHost(host: string): string {
  const unbracketed = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return isIP(unbracketed) === 6 ? `[${unbracketed}]` : host
}

/** Sends one bounded, DNS-pinned statement through ClickHouse's HTTP interface. */
export async function requestClickHouse(
  config: ClickHouseConnectionConfig,
  statement: string,
  options: ClickHouseRequestOptions = {}
): Promise<ClickHouseHttpResult> {
  options.signal?.throwIfAborted()
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  options.signal?.throwIfAborted()
  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const protocol = config.secure ? 'https' : 'http'
  const url = new URL(`${protocol}://${formatUrlHost(config.host)}:${config.port}/`)
  url.searchParams.set('database', config.database)
  if (options.readOnly) url.searchParams.set('readonly', '1')

  const response = await secureFetchWithPinnedIP(url.toString(), hostValidation.resolvedIP, {
    method: 'POST',
    headers: {
      'X-ClickHouse-User': config.username,
      'X-ClickHouse-Key': config.password,
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(statement, 'utf-8')),
    },
    body: statement,
    timeout: REQUEST_TIMEOUT_MS,
    profile: 'selfHostedService',
    maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
    redirectPolicy: {
      mode: 'standard',
      sendCredentialsOnCrossOriginRedirect: false,
      sensitiveHeaders: ['X-ClickHouse-User', 'X-ClickHouse-Key'],
    },
    signal: options.signal,
  })

  const text = await response.text()
  options.signal?.throwIfAborted()
  if (!response.ok) {
    throw new Error(text.trim() || `ClickHouse request failed with status ${response.status}`)
  }

  return { text, summary: parseSummary(response.headers.get('x-clickhouse-summary')) }
}
