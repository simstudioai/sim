import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  isSensitiveKey,
  REDACTED_MARKER,
  redactApiKeys,
  redactExactSensitiveValues,
} from '@/lib/core/security/redaction'
import { consumeOrCancelBody } from '@/lib/core/utils/stream-limits'
import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import type { OracleFusionAuthInput } from '@/lib/internal/oracle-fusion-financials/schema'

const REQUEST_TIMEOUT_MS = 30_000
const RESPONSE_MAX_BYTES = 5 * 1024 * 1024
const MAX_RETRIES = 2
const TRANSIENT_STATUSES = new Set([429, 503, 504])
const TRANSIENT_TRANSPORT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
])
const MAX_STRUCTURED_DIAGNOSTIC_DEPTH = 8
const UNSAFE_DIAGNOSTIC = Symbol('unsafe-oracle-diagnostic')
const DIAGNOSTIC_KEY_VALUE_PATTERN =
  /(?:"([^"\r\n]{1,128})"|'([^'\r\n]{1,128})'|([A-Za-z][A-Za-z0-9 _-]{0,127}))\s*(?::|=)/g
const LOSSLESS_DECIMAL_FIELDS = new Set([
  'InvoiceId',
  'InvoiceDistributionId',
  'CheckId',
  'PaymentId',
  'PaymentReference',
  'PaymentNumber',
  'InvoicePaymentId',
  'HoldId',
  'PaymentProcessRequestId',
  'SourceApplicationIdentifier',
  'termsId',
  'setId',
])
const DECIMAL_INTEGER_TOKEN = /^\d+$/

interface JsonParseContext {
  source?: string
}

type JsonParseWithSource = (
  text: string,
  reviver: (this: unknown, key: string, value: unknown, context?: JsonParseContext) => unknown
) => unknown

const jsonParseWithSource = JSON.parse as JsonParseWithSource

export class OracleFusionFinancialsProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'OracleFusionFinancialsProviderError'
  }
}

function collectOracleErrorMessages(payload: unknown, depth = 0): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const object = payload as Record<string, unknown>
  const messages: string[] = []
  for (const key of ['title', 'detail', 'message']) {
    const value = object[key]
    if (typeof value === 'string' && value.trim()) messages.push(value.trim())
  }
  const nested = object.error
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const message = (nested as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) messages.push(message.trim())
  }
  const details = object['o:errorDetails']
  if (Array.isArray(details) && depth < 2) {
    for (const detail of details.slice(0, 5)) {
      messages.push(...collectOracleErrorMessages(detail, depth + 1))
    }
  }
  return messages
}

function isSensitiveDiagnosticKey(key: string): boolean {
  return isSensitiveKey(key.trim().replaceAll(/\s+/g, '_'))
}

function containsSensitiveDiagnosticKey(value: string): boolean {
  for (const match of value.matchAll(DIAGNOSTIC_KEY_VALUE_PATTERN)) {
    if (isSensitiveDiagnosticKey(match[1] ?? match[2] ?? match[3] ?? '')) return true
  }
  return false
}

function sanitizeStructuredDiagnosticValue(
  value: unknown,
  accessToken: string,
  depth: number
): unknown | typeof UNSAFE_DIAGNOSTIC {
  if (depth > MAX_STRUCTURED_DIAGNOSTIC_DEPTH) return UNSAFE_DIAGNOSTIC
  if (typeof value === 'string') {
    return sanitizeOracleDiagnostic(value, accessToken, depth) ?? UNSAFE_DIAGNOSTIC
  }
  if (Array.isArray(value)) {
    const sanitized: unknown[] = []
    for (const item of value) {
      const result = sanitizeStructuredDiagnosticValue(item, accessToken, depth + 1)
      if (result === UNSAFE_DIAGNOSTIC) return UNSAFE_DIAGNOSTIC
      sanitized.push(result)
    }
    return sanitized
  }
  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveDiagnosticKey(key)) {
        sanitized[key] = REDACTED_MARKER
        continue
      }
      const result = sanitizeStructuredDiagnosticValue(item, accessToken, depth + 1)
      if (result === UNSAFE_DIAGNOSTIC) return UNSAFE_DIAGNOSTIC
      sanitized[key] = result
    }
    return sanitized
  }
  return value
}

function sanitizeOracleDiagnostic(message: string, accessToken: string, depth = 0): string | null {
  const trimmed = message.trim()
  if (trimmed === REDACTED_MARKER) return trimmed
  if (!trimmed.includes('{') && !trimmed.includes('[')) {
    const redacted = redactExactSensitiveValues(trimmed, [accessToken])
    return containsSensitiveDiagnosticKey(redacted) ? null : redacted
  }
  if (depth >= MAX_STRUCTURED_DIAGNOSTIC_DEPTH) return null

  try {
    const structured = JSON.parse(trimmed)
    if (!structured || typeof structured !== 'object') return null
    const sanitized = sanitizeStructuredDiagnosticValue(
      redactApiKeys(structured),
      accessToken,
      depth + 1
    )
    if (sanitized === UNSAFE_DIAGNOSTIC) return null
    return redactExactSensitiveValues(JSON.stringify(sanitized), [accessToken])
  } catch {
    // Provider-controlled text that resembles embedded structured data is not
    // reflected unless the complete diagnostic can be parsed and redacted.
    return null
  }
}

function sanitizeOracleError(body: string, accessToken: string, status: number): string {
  let messages: string[] = []
  try {
    messages = collectOracleErrorMessages(redactApiKeys(JSON.parse(body)))
  } catch {
    // Non-JSON proxy pages are intentionally not reflected to tool callers.
  }
  const unique = [
    ...new Set(
      messages
        .map((message) => sanitizeOracleDiagnostic(message, accessToken))
        .filter((message): message is string => Boolean(message))
    ),
  ]
  const safe = truncate(unique.join(' — '), 1_000)
  return safe || `Oracle Fusion Financials request failed with HTTP ${status}`
}

/** Keeps Oracle int64 identifiers exact while leaving monetary and counter fields numeric. */
function parseOracleFusionJson(body: string): unknown {
  return jsonParseWithSource(body, (key, value, context) => {
    if (!LOSSLESS_DECIMAL_FIELDS.has(key) || typeof value !== 'number') return value
    const source = context?.source
    return source && DECIMAL_INTEGER_TOKEN.test(source) ? source : value
  })
}

function isTransientTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message === `Request timed out after ${REQUEST_TIMEOUT_MS}ms`) return true
  return (
    'code' in error && typeof error.code === 'string' && TRANSIENT_TRANSPORT_CODES.has(error.code)
  )
}

async function waitForRetry(
  attempt: number,
  signal?: AbortSignal,
  retryAfterMs: number | null = null
) {
  await interruptibleSleep(
    backoffWithJitter(attempt + 1, retryAfterMs, { baseMs: 250, maxMs: 5_000 }),
    signal
  )
  signal?.throwIfAborted()
}

export interface OracleFusionRequest {
  path: string
  query?: Record<string, string | number | boolean | undefined>
}

function buildRequestUrl(origin: string, request: OracleFusionRequest): string {
  const url = new URL(request.path, origin)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function fetchAttempt(
  url: string,
  resolvedIP: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<SecureFetchResponse> {
  return secureFetchWithPinnedIP(url, resolvedIP, {
    profile: 'configuredEndpoint',
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
    maxResponseBytes: RESPONSE_MAX_BYTES,
    signal,
    logUrlValidationDetails: false,
  })
}

/** Executes one bounded, credential-bound Oracle GET with transient retries. */
export async function requestOracleFusionJson(
  auth: Pick<OracleFusionAuthInput, 'accessToken' | 'instanceUrl'>,
  request: OracleFusionRequest,
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const origin = normalizeOracleFusionApplicationOrigin(auth.instanceUrl)
  if (!origin)
    throw new Error('Oracle Fusion credential is not bound to a canonical application URL')
  const validation = await validateUrlWithDNS(
    origin,
    'Fusion Applications URL',
    'configuredEndpoint',
    {
      logDetails: false,
    }
  )
  if (!validation.isValid) {
    throw new Error('Oracle Fusion credential application URL is not a public endpoint')
  }
  const url = buildRequestUrl(origin, request)

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    signal?.throwIfAborted()
    let response: SecureFetchResponse
    try {
      response = await fetchAttempt(url, validation.resolvedIP, auth.accessToken, signal)
    } catch (error) {
      signal?.throwIfAborted()
      if (isTransientTransportError(error) && attempt < MAX_RETRIES) {
        await waitForRetry(attempt, signal)
        continue
      }
      throw new Error('Could not reach Oracle Fusion Financials')
    }

    if (TRANSIENT_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      await consumeOrCancelBody(response)
      await waitForRetry(attempt, signal, retryAfterMs)
      continue
    }

    let body: string
    try {
      body = await response.text()
    } catch (error) {
      signal?.throwIfAborted()
      if (isTransientTransportError(error) && attempt < MAX_RETRIES) {
        await waitForRetry(attempt, signal)
        continue
      }
      throw new OracleFusionFinancialsProviderError(
        'Oracle Fusion Financials response could not be read',
        502
      )
    }
    signal?.throwIfAborted()
    if (!response.ok) {
      throw new OracleFusionFinancialsProviderError(
        sanitizeOracleError(body, auth.accessToken, response.status),
        response.status
      )
    }
    try {
      return parseOracleFusionJson(body)
    } catch {
      throw new OracleFusionFinancialsProviderError(
        'Oracle Fusion Financials returned a malformed JSON response',
        502
      )
    }
  }
  throw new Error('Oracle Fusion Financials retry loop exhausted')
}
