import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { createTimeoutAbortController, getRemainingExecutionMs } from '@/lib/core/execution-limits'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { consumeOrCancelBody, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { isOracleFusionIntegralJsonNumberToken } from '@/lib/internal/oracle-fusion/identifiers'
import {
  buildOracleFusionResourcePath,
  type OracleFusionResourceAddress,
} from '@/lib/internal/oracle-fusion/paths'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'

const REQUEST_TIMEOUT_MS = 30_000
const RETRY_AFTER_MAX_MS = 5_000
const RETRY_RESERVE_MS = 5_000
const RESPONSE_MAX_BYTES = 5 * 1024 * 1024
const MAX_GET_RETRIES = 1
const TRANSIENT_STATUSES = new Set([429, 503, 504])
const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const MEDIA_TYPES = new Set([
  'application/json',
  'application/vnd.oracle.adf.resourceitem+json',
  'application/vnd.oracle.adf.action+json',
])
const OPERATION_HEADER_KEYS = new Set(['effectiveOf', 'ifMatch', 'upsertMode'])
const HEADER_VALUE_MAX_LENGTH = 2_048
const HEADER_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

interface JsonParseContext {
  source?: string
}

type JsonParseWithSource = (
  text: string,
  reviver: (this: unknown, key: string, value: unknown, context?: JsonParseContext) => unknown
) => unknown

const jsonParseWithSource = JSON.parse as JsonParseWithSource

export interface OracleFusionResolvedCredential {
  instanceUrl: string
  accessToken: string
}

export type OracleFusionMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export type OracleFusionMediaType =
  | 'application/json'
  | 'application/vnd.oracle.adf.resourceitem+json'
  | 'application/vnd.oracle.adf.action+json'

export interface OracleFusionOperationHeaders {
  effectiveOf?: string
  ifMatch?: string
  upsertMode?: boolean
}

interface OracleFusionRequestBase {
  address: OracleFusionResourceAddress
  query?: Record<string, string | number | boolean | undefined>
  operationHeaders?: OracleFusionOperationHeaders
}

export type OracleFusionRequest = OracleFusionRequestBase &
  (
    | { method?: 'GET'; body?: never; mediaType?: never }
    | { method: 'DELETE'; body?: never; mediaType?: never }
    | {
        method: 'POST' | 'PATCH' | 'PUT'
        body: unknown
        mediaType: OracleFusionMediaType
      }
  )

interface PreparedRequest {
  method: OracleFusionMethod
  headers: Record<string, string>
  body?: string
}

function validateBasicCredential(accessToken: string): void {
  if (
    !accessToken ||
    accessToken.length > 4096 ||
    accessToken.length % 4 !== 0 ||
    !CANONICAL_BASE64.test(accessToken)
  ) {
    throw new Error('Oracle Fusion credential is malformed')
  }
}

function buildRequestUrl(origin: string, request: OracleFusionRequest): string {
  const resourcePath = buildOracleFusionResourcePath(request.address)
  const url = new URL(`${origin}${resourcePath}`)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value === undefined) continue
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Oracle Fusion query values must be finite')
    }
    url.searchParams.set(key, String(value))
  }
  if (url.origin !== origin || url.pathname !== resourcePath) {
    throw new Error('Oracle Fusion request must remain on the credential-bound API root')
  }
  return url.toString()
}

function parseOracleFusionJson(body: string): unknown {
  return jsonParseWithSource(body, (_key, value, context) => {
    if (typeof value !== 'number' || Number.isSafeInteger(value)) return value
    const source = context?.source
    return source && isOracleFusionIntegralJsonNumberToken(source) ? source : value
  })
}

function validateHeaderValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Oracle Fusion operation header values must be strings')
  }
  const normalized = value.trim()
  if (
    !normalized ||
    normalized !== value ||
    normalized.length > HEADER_VALUE_MAX_LENGTH ||
    HEADER_CONTROL_CHARACTERS.test(normalized)
  ) {
    throw new Error('Oracle Fusion operation header value is invalid')
  }
  return normalized
}

function appendOperationHeaders(
  target: Record<string, string>,
  operationHeaders: OracleFusionOperationHeaders | undefined
): void {
  if (operationHeaders === undefined) return
  if (
    operationHeaders === null ||
    typeof operationHeaders !== 'object' ||
    Array.isArray(operationHeaders) ||
    (Object.getPrototypeOf(operationHeaders) !== Object.prototype &&
      Object.getPrototypeOf(operationHeaders) !== null)
  ) {
    throw new Error('Oracle Fusion operation headers must be a plain object')
  }
  for (const key of Reflect.ownKeys(operationHeaders)) {
    if (typeof key !== 'string' || !OPERATION_HEADER_KEYS.has(key)) {
      throw new Error('Oracle Fusion operation header is not supported')
    }
    const descriptor = Object.getOwnPropertyDescriptor(operationHeaders, key)
    if (!descriptor || descriptor.get || descriptor.set) {
      throw new Error('Oracle Fusion operation header is not supported')
    }
  }
  if (operationHeaders.effectiveOf !== undefined) {
    target['Effective-Of'] = validateHeaderValue(operationHeaders.effectiveOf)
  }
  if (operationHeaders.ifMatch !== undefined) {
    target['If-Match'] = validateHeaderValue(operationHeaders.ifMatch)
  }
  if (operationHeaders.upsertMode !== undefined) {
    if (typeof operationHeaders.upsertMode !== 'boolean') {
      throw new Error('Oracle Fusion Upsert-Mode must be boolean')
    }
    target['Upsert-Mode'] = String(operationHeaders.upsertMode)
  }
}

function prepareRequest(accessToken: string, request: OracleFusionRequest): PreparedRequest {
  const method = request.method ?? 'GET'
  if (!METHODS.has(method)) throw new Error('Oracle Fusion request method is not supported')

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Basic ${accessToken}`,
    'REST-Framework-Version': '9',
  }
  appendOperationHeaders(headers, request.operationHeaders)

  const hasBody = 'body' in request && request.body !== undefined
  if (method === 'GET' || method === 'DELETE') {
    if (hasBody || 'mediaType' in request) {
      throw new Error(`Oracle Fusion ${method} requests must not include a body`)
    }
    return { method, headers }
  }

  if (!hasBody) throw new Error(`Oracle Fusion ${method} requests require a JSON body`)
  if (!MEDIA_TYPES.has(request.mediaType)) {
    throw new Error('Oracle Fusion request media type is not supported')
  }
  headers['Content-Type'] = request.mediaType
  return { method, headers, body: serializeOracleFusionJsonBody(request.body) }
}

function retryDelay(attempt: number, retryAfterMs: number | null): number {
  return backoffWithJitter(attempt + 1, retryAfterMs, {
    baseMs: 250,
    maxMs: RETRY_AFTER_MAX_MS,
  })
}

async function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  await interruptibleSleep(delay, signal)
  signal?.throwIfAborted()
}

function hasTimeForRetry(delay: number, signal?: AbortSignal): boolean {
  const remaining = getRemainingExecutionMs(signal)
  return remaining === undefined || remaining >= delay + REQUEST_TIMEOUT_MS + RETRY_RESERVE_MS
}

async function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(signal.reason ?? new DOMException('user', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })
}

async function fetchAttempt(
  url: string,
  resolvedIP: string,
  prepared: PreparedRequest,
  signal: AbortSignal
): Promise<SecureFetchResponse> {
  return waitWithSignal(
    secureFetchWithPinnedIP(url, resolvedIP, {
      profile: 'configuredEndpoint',
      method: prepared.method,
      headers: prepared.headers,
      ...(prepared.body === undefined ? {} : { body: prepared.body }),
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
      maxResponseBytes: RESPONSE_MAX_BYTES,
      signal,
      logUrlValidationDetails: false,
    }),
    signal
  )
}

function statusMessage(status: number): string {
  if (status === 401) return 'Oracle Fusion authentication failed'
  if (status === 403) return 'Oracle Fusion denied this request'
  if (status === 404) return 'Oracle Fusion resource was not found'
  if (status === 429) return 'Oracle Fusion rate limit exceeded'
  return `Oracle Fusion request failed with HTTP ${status}`
}

/** `maxRedirects: 0` rejects a response with Location before returning its status. */
function isRejectedRedirect(error: unknown): boolean {
  return error instanceof Error && error.message === 'Too many redirects (max: 0)'
}

function mapAttemptError(error: unknown, timedOut: boolean, callerSignal?: AbortSignal): never {
  callerSignal?.throwIfAborted()
  if (error instanceof OracleFusionProviderError) throw error
  if (timedOut) {
    throw new OracleFusionProviderError('Oracle Fusion request timed out', 504)
  }
  if (isRejectedRedirect(error)) {
    throw new OracleFusionProviderError('Oracle Fusion returned a redirect', 502)
  }
  if (isPayloadSizeLimitError(error)) {
    throw new OracleFusionProviderError('Oracle Fusion response exceeded 5 MiB', 502)
  }
  if (error instanceof Error && error.message.includes('timed out')) {
    throw new OracleFusionProviderError('Oracle Fusion request timed out', 504)
  }
  throw new OracleFusionProviderError('Could not reach Oracle Fusion', 502)
}

async function readJsonResponse(
  response: SecureFetchResponse,
  signal: AbortSignal
): Promise<unknown> {
  let body: string
  try {
    body = await waitWithSignal(response.text(), signal)
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      throw new OracleFusionProviderError('Oracle Fusion response exceeded 5 MiB', 502)
    }
    throw error
  }
  try {
    return parseOracleFusionJson(body)
  } catch {
    throw new OracleFusionProviderError('Oracle Fusion returned malformed JSON', 502)
  }
}

async function consumeResponse(response: SecureFetchResponse, signal: AbortSignal): Promise<void> {
  await waitWithSignal(consumeOrCancelBody(response), signal)
}

async function validateCredentialOrigin(origin: string, signal?: AbortSignal): Promise<string> {
  let validation: Awaited<ReturnType<typeof validateUrlWithDNS>>
  try {
    validation = await validateUrlWithDNS(origin, 'Fusion Applications URL', 'configuredEndpoint', {
      logDetails: false,
    })
  } catch {
    signal?.throwIfAborted()
    throw new Error('Oracle Fusion credential application URL could not be validated')
  }
  signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new Error('Oracle Fusion credential application URL is not a public endpoint')
  }
  return validation.resolvedIP
}

async function requestOracleFusion(
  credential: OracleFusionResolvedCredential,
  request: OracleFusionRequest,
  responseMode: 'json' | 'empty',
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const origin = normalizeOracleFusionApplicationOrigin(credential.instanceUrl)
  if (!origin) {
    throw new Error('Oracle Fusion credential is not bound to a canonical application URL')
  }
  validateBasicCredential(credential.accessToken)
  const prepared = prepareRequest(credential.accessToken, request)
  const url = buildRequestUrl(origin, request)
  const resolvedIP = await validateCredentialOrigin(origin, signal)
  const maxRetries = prepared.method === 'GET' ? MAX_GET_RETRIES : 0

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    signal?.throwIfAborted()
    const deadline = createTimeoutAbortController(REQUEST_TIMEOUT_MS, signal)
    let delay: number | undefined
    try {
      const response = await fetchAttempt(url, resolvedIP, prepared, deadline.signal)
      if (TRANSIENT_STATUSES.has(response.status) && attempt < maxRetries) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get('retry-after'),
          RETRY_AFTER_MAX_MS
        )
        await consumeResponse(response, deadline.signal)
        const candidateDelay = retryDelay(attempt, retryAfterMs)
        if (hasTimeForRetry(candidateDelay, signal)) delay = candidateDelay
        else throw new OracleFusionProviderError(statusMessage(response.status), response.status)
      } else if (!response.ok) {
        await consumeResponse(response, deadline.signal)
        throw new OracleFusionProviderError(statusMessage(response.status), response.status)
      } else if (responseMode === 'json') {
        return await readJsonResponse(response, deadline.signal)
      } else {
        await consumeResponse(response, deadline.signal)
        return
      }
    } catch (error) {
      mapAttemptError(error, deadline.isTimedOut(), signal)
    } finally {
      deadline.cleanup()
    }

    if (delay !== undefined) await waitForRetry(delay, signal)
  }

  throw new OracleFusionProviderError('Oracle Fusion retry limit was exhausted', 502)
}

/** Executes a bounded request and parses a required JSON success response losslessly. */
export async function requestOracleFusionJson(
  credential: OracleFusionResolvedCredential,
  request: OracleFusionRequest,
  signal?: AbortSignal
): Promise<unknown> {
  return requestOracleFusion(credential, request, 'json', signal)
}

/** Executes a bounded request and consumes or cancels its success response body. */
export async function requestOracleFusionEmpty(
  credential: OracleFusionResolvedCredential,
  request: OracleFusionRequest,
  signal?: AbortSignal
): Promise<void> {
  await requestOracleFusion(credential, request, 'empty', signal)
}
