import { createHmac } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { isPrivateIpHost } from '@sim/security/ssrf'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { env } from '@/lib/core/config/env'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { PayloadSizeLimitError, readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import type { SapConcurApiInput, SapConcurAuth } from '@/lib/internal/sap-concur/schema'

const logger = createLogger('SapConcurClient')

/** Documented host form for a Concur geolocation, including `www-` prefixed variants. */
const SAP_CONCUR_GEOLOCATION_HOST_PATTERN = /^(www-)?[a-z0-9-]+\.api\.concursolutions\.com$/

const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
  '[::1]',
  '[::]',
  '[::ffff:127.0.0.1]',
  '[fd00:ec2::254]',
])

/** Validate a URL is https and not pointing to a private/loopback host. */
export function assertSafeExternalUrl(rawUrl: string, label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https://`)
  }
  const host = parsed.hostname.toLowerCase()
  if (FORBIDDEN_HOSTS.has(host) || FORBIDDEN_HOSTS.has(`[${host}]`)) {
    throw new Error(`${label} host is not allowed`)
  }
  if (isPrivateIpHost(host)) {
    throw new Error(`${label} host is not allowed (private/loopback range)`)
  }
  return parsed
}

interface CachedToken {
  accessToken: string
  geolocation: string
  expiresAt: number
}

/** Access token plus the geolocation every subsequent API call for it must be sent to. */
export interface SapConcurToken {
  accessToken: string
  geolocation: string
}

const TOKEN_CACHE = new Map<string, CachedToken>()
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000
export const SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS = 30_000

interface InFlightTokenRequest {
  controller: AbortController
  promise: Promise<SapConcurToken>
  state: {
    settled: boolean
    waiters: number
  }
}

const TOKEN_REQUESTS = new Map<string, InFlightTokenRequest>()
const TOKEN_REQUESTS_MAX_ENTRIES = 500

/** Cached token for `key`, or `undefined` when absent or inside the expiry safety window. */
function readCachedToken(key: string): SapConcurToken | undefined {
  const cached = TOKEN_CACHE.get(key)
  if (!cached || cached.expiresAt - TOKEN_SAFETY_WINDOW_MS <= Date.now()) return undefined
  return { accessToken: cached.accessToken, geolocation: cached.geolocation }
}

/**
 * Cache key covering every factor that authenticates the token request. The password
 * and company UUID must participate: without them a cache hit skips the token endpoint
 * entirely, so a request carrying the wrong password would be served a token minted from
 * someone else's correct credentials out of this module-global cache.
 *
 * The whole tuple is JSON-encoded before hashing rather than concatenated with a
 * separator, so a free-form field (clientId, companyUuid) cannot span a field boundary
 * and collide with a different tuple.
 *
 * Keyed with a server-side secret rather than a bare digest. The inputs include a
 * user-chosen password, which is low-entropy enough to brute-force from a plain SHA-256
 * if a key ever reached a heap dump or a debug log; an HMAC makes the key useless without
 * the secret. A password-hashing KDF would be the wrong tool — this runs on every token
 * fetch and the goal is collision-free partitioning, not verification of a stored
 * credential.
 */
function tokenCacheKey(req: SapConcurAuth): string {
  const payload = JSON.stringify([
    req.datacenter,
    req.grantType,
    req.clientId,
    req.clientSecret,
    req.username ?? '',
    req.password ?? '',
    req.companyUuid ?? '',
    req.credtype ?? '',
  ])
  const hmac = createHmac('sha256', env.INTERNAL_API_SECRET)
  hmac.update(payload, 'utf8')
  return hmac.digest('hex')
}

/**
 * Insert a token and evict from the front once the cache is over its cap.
 *
 * Eviction is FIFO by insertion order, not LRU — a cache *read* does not move an entry
 * back. At 500 entries that is deliberate: a token is short-lived and re-minted on the
 * next miss, so the extra bookkeeping an LRU needs buys nothing here.
 */
function rememberToken(key: string, token: CachedToken): void {
  if (TOKEN_CACHE.has(key)) TOKEN_CACHE.delete(key)
  TOKEN_CACHE.set(key, token)
  while (TOKEN_CACHE.size > TOKEN_CACHE_MAX_ENTRIES) {
    const oldestKey = TOKEN_CACHE.keys().next().value
    if (oldestKey === undefined) break
    TOKEN_CACHE.delete(oldestKey)
  }
}

function normalizeGeolocation(raw: string | undefined, fallback: string): string {
  if (!raw) return `https://${fallback}`
  const trimmed = raw.replace(/\/+$/, '')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}

/**
 * Cap for an unstructured token-endpoint error body, applied both to the log line and to
 * the surfaced message. The token request body is form-encoded
 * `client_id=…&client_secret=…&password=…`, so an intermediary (WAF, proxy, captive
 * portal) that echoes the request it rejected would otherwise have its page returned to
 * the caller verbatim. Structured Concur error shapes are unaffected — they are matched
 * before the raw fallback is reached.
 */
const TOKEN_ERROR_RAW_BODY_MAX_LENGTH = 200

/**
 * Blank out the credential values this module just submitted, wherever they appear in an
 * error body.
 *
 * Truncation alone bounds the exposure but does not remove it — a secret can sit inside
 * the surviving prefix. Because the exact values are known at the callsite, they can be
 * substituted out precisely. A genuine Concur error body never contains them, so this is
 * a no-op for every documented shape and only bites on an intermediary echoing our
 * request back at us.
 */
function redactTokenSecrets(text: string, auth: SapConcurAuth): string {
  if (!text) return text
  let redacted = text
  for (const secret of [auth.clientSecret, auth.password]) {
    if (secret && secret.length > 0) redacted = redacted.split(secret).join('[redacted]')
  }
  return redacted
}

/** Best-effort JSON parse of an error body, falling back to the raw text. */
function parseMaybeJson(text: string): unknown {
  if (!text) return ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Acquire a Concur access token, sharing a cache across direct tool operations.
 * Validates that the geolocation returned by Concur is a safe external URL.
 *
 * Misses are coalesced per cache key: a parallel block fanning out many Concur calls, or
 * a cold container after a deploy, would otherwise fire one `POST /oauth2/v0/token` per
 * branch into an endpoint Concur rate-limits hard. Coalescing also removes an
 * interleaving hazard — with concurrent mints, a slow response settling last could cache
 * an earlier-expiring token over a fresher one.
 *
 * Two password-grant shapes are supported:
 *
 * - User-level: `username` is the user's login and `password` their password. `credtype`
 *   is omitted, which Concur reads as its `password` default.
 * - Company-level: when `companyUuid` is set, Concur's documented company flow is
 *   `grant_type=password&username=<companyUUID>&password=<request token>&credtype=authtoken`.
 *   The company UUID is submitted as `username` and `credtype` defaults to `authtoken`.
 *   An explicitly supplied `credtype` always wins.
 *
 * KNOWN LIMITATION of the company flow: the company request token obtained from the App
 * Center is valid for 24 hours only, and Concur returns a `refresh_token` alongside the
 * access token so the connection can outlive it. Refresh-token exchange is not
 * implemented here, so a company connection stops working once the request token expires
 * and a fresh one must be issued.
 *
 * Token-endpoint failures carry `{ code, error, error_description, geolocation? }`.
 * Code 16 ("user lives elsewhere") additionally returns the correct geolocation for the
 * tenant; retrying the token request against that host is not implemented here.
 */
export async function fetchSapConcurAccessToken(
  auth: SapConcurAuth,
  requestId: string,
  signal?: AbortSignal
): Promise<SapConcurToken> {
  signal?.throwIfAborted()
  if (auth.grantType === 'password') {
    if (!auth.username && !auth.companyUuid) {
      throw new Error(
        'username is required for password grant (or companyUuid for company-level auth)'
      )
    }
    if (!auth.password) throw new Error('password is required for password grant')
  }

  const cacheKey = tokenCacheKey(auth)
  const cached = readCachedToken(cacheKey)
  if (cached) return cached

  const existing = TOKEN_REQUESTS.get(cacheKey)
  if (!existing && TOKEN_REQUESTS.size >= TOKEN_REQUESTS_MAX_ENTRIES) {
    return requestAccessToken(auth, requestId, cacheKey, signal)
  }
  const request = existing ?? createTokenRequest(auth, requestId, cacheKey)
  return waitForTokenRequest(request, signal)
}

function createTokenRequest(
  auth: SapConcurAuth,
  requestId: string,
  cacheKey: string
): InFlightTokenRequest {
  const controller = new AbortController()
  const state = { settled: false, waiters: 0 }
  const promise = requestAccessToken(auth, requestId, cacheKey, controller.signal).finally(() => {
    state.settled = true
    if (TOKEN_REQUESTS.get(cacheKey)?.controller === controller) TOKEN_REQUESTS.delete(cacheKey)
  })
  const request = { controller, promise, state }
  TOKEN_REQUESTS.set(cacheKey, request)
  return request
}

async function waitForTokenRequest(
  request: InFlightTokenRequest,
  signal?: AbortSignal
): Promise<SapConcurToken> {
  signal?.throwIfAborted()
  request.state.waiters += 1
  let onAbort: (() => void) | undefined
  const aborted = signal
    ? new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        signal.addEventListener('abort', onAbort, { once: true })
      })
    : undefined

  try {
    return await (aborted ? Promise.race([request.promise, aborted]) : request.promise)
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    request.state.waiters -= 1
    if (!request.state.settled && request.state.waiters === 0) {
      request.controller.abort(signal?.reason)
    }
  }
}

/** Mint a fresh token from the Concur token endpoint and cache it under `cacheKey`. */
async function requestAccessToken(
  auth: SapConcurAuth,
  requestId: string,
  cacheKey: string,
  signal?: AbortSignal
): Promise<SapConcurToken> {
  const tokenUrl = assertSafeExternalUrl(
    `https://${auth.datacenter}/oauth2/v0/token`,
    'tokenUrl'
  ).toString()

  const params = new URLSearchParams()
  params.set('client_id', auth.clientId)
  params.set('client_secret', auth.clientSecret)
  params.set('grant_type', auth.grantType)
  if (auth.grantType === 'password') {
    const companyUuid = auth.companyUuid
    params.set('username', companyUuid ?? auth.username ?? '')
    params.set('password', auth.password ?? '')
    const credtype = auth.credtype ?? (companyUuid ? 'authtoken' : undefined)
    if (credtype) params.set('credtype', credtype)
  }

  const response = await secureFetchWithValidation(
    tokenUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
      timeout: SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS,
      maxRedirects: 0,
      stripAuthOnRedirect: true,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
    },
    'tokenUrl'
  )
  signal?.throwIfAborted()

  if (!response.ok) {
    const text = redactTokenSecrets(await response.text().catch(() => ''), auth)
    signal?.throwIfAborted()
    logger.warn(
      `[${requestId}] Concur token fetch failed (${response.status}): ${truncate(
        text,
        TOKEN_ERROR_RAW_BODY_MAX_LENGTH
      )}`
    )
    throw new Error(
      `Concur token request failed: ${extractSapConcurError(parseMaybeJson(text), response.status, {
        maxRawBodyLength: TOKEN_ERROR_RAW_BODY_MAX_LENGTH,
      })}`
    )
  }

  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
    geolocation?: string
  }
  signal?.throwIfAborted()

  if (!data.access_token) {
    throw new Error('Concur token response missing access_token')
  }

  const geolocation = normalizeGeolocation(data.geolocation, auth.datacenter)
  const geolocationUrl = assertSafeExternalUrl(geolocation, 'geolocation')
  if (!SAP_CONCUR_GEOLOCATION_HOST_PATTERN.test(geolocationUrl.hostname.toLowerCase())) {
    throw new Error(
      `Concur geolocation host is not a valid Concur API host: ${geolocationUrl.hostname}`
    )
  }

  const expiresInMs = (data.expires_in ?? 3600) * 1000
  rememberToken(cacheKey, {
    accessToken: data.access_token,
    geolocation,
    expiresAt: Date.now() + expiresInMs,
  })
  return { accessToken: data.access_token, geolocation }
}

export interface SapConcurInvocation {
  status: number
  body: unknown
  headers: Record<string, string>
}

function buildApiUrl(geolocation: string, input: SapConcurApiInput): string {
  const base = geolocation.replace(/\/+$/, '')
  const subPath = input.path.startsWith('/') ? input.path : `/${input.path}`
  const url = `${base}${subPath}`
  if (!input.query || Object.keys(input.query).length === 0) return url

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(input.query)) {
    if (value === undefined || value === null) continue
    search.append(key, String(value))
  }
  const queryString = search.toString()
  if (!queryString) return url
  return url.includes('?') ? `${url}&${queryString}` : `${url}?${queryString}`
}

export async function readConcurApiBody(response: {
  status: number
  text: () => Promise<string>
}): Promise<string> {
  const read = response.text()
  if (response.status >= 200 && response.status < 300) return read
  return read.catch(() => '')
}

function parseResponseBody(raw: string): unknown {
  if (raw.length === 0) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export async function invokeSapConcur(
  input: SapConcurApiInput,
  accessToken: string,
  geolocation: string,
  signal?: AbortSignal
): Promise<SapConcurInvocation> {
  signal?.throwIfAborted()
  const url = assertSafeExternalUrl(buildApiUrl(geolocation, input), 'apiUrl').toString()
  const hasBody = input.body !== undefined && input.body !== null
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: input.accept ?? 'application/json',
    'concur-correlationid': generateId(),
  }
  if (hasBody) headers['Content-Type'] = input.contentType ?? 'application/json'

  const response = await secureFetchWithValidation(
    url,
    {
      method: input.method,
      headers,
      body: hasBody
        ? typeof input.body === 'string'
          ? input.body
          : JSON.stringify(input.body)
        : undefined,
      timeout: SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS,
      maxRedirects: 0,
      stripAuthOnRedirect: true,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
    },
    'apiUrl'
  )
  signal?.throwIfAborted()
  const raw = await readConcurApiBody(response)
  signal?.throwIfAborted()
  return {
    status: response.status,
    body: parseResponseBody(raw),
    headers: forwardedSapConcurHeaders(response.headers),
  }
}

export async function readConcurUploadBody(response: {
  status: number
  headers?: { get(name: string): string | null }
  body?: ReadableStream<Uint8Array> | null
  arrayBuffer?: () => Promise<ArrayBuffer>
  text?: () => Promise<string>
}): Promise<string> {
  const read = readResponseTextWithLimit(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Concur upload response',
  })
  if (response.status >= 200 && response.status < 300) return read
  return read.catch(() => '')
}

export async function invokeSapConcurMultipart(
  url: string,
  accessToken: string,
  formData: FormData,
  maxBodyBytes: number,
  signal?: AbortSignal
): Promise<SapConcurInvocation> {
  signal?.throwIfAborted()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'concur-correlationid': generateId(),
  }
  const serialized = new Request('http://localhost/internal-multipart-serializer', {
    method: 'POST',
    body: formData,
  })
  const contentType = serialized.headers.get('content-type')
  if (contentType) headers['Content-Type'] = contentType
  const bodyBuffer = Buffer.from(await serialized.arrayBuffer())
  signal?.throwIfAborted()
  if (bodyBuffer.length > maxBodyBytes) {
    throw new PayloadSizeLimitError({
      label: 'Concur multipart request',
      maxBytes: maxBodyBytes,
      observedBytes: bodyBuffer.length,
    })
  }

  const response = await secureFetchWithValidation(
    url,
    {
      method: 'POST',
      headers,
      body: bodyBuffer,
      timeout: SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS,
      maxRedirects: 0,
      stripAuthOnRedirect: true,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
    },
    'apiUrl'
  )
  signal?.throwIfAborted()
  const raw = await readConcurUploadBody(response)
  signal?.throwIfAborted()
  let body = parseResponseBody(raw)
  if (
    body === null ||
    (typeof body === 'object' && body !== null && Object.keys(body).length === 0)
  ) {
    const location = response.headers.get('Location')
    const link = response.headers.get('Link')
    if (location || link) body = { location, link }
  }
  return {
    status: response.status,
    body,
    headers: forwardedSapConcurHeaders(response.headers),
  }
}

/**
 * Concur response headers carried through onto the direct operation response.
 *
 * `Retry-After` is the load-bearing one: the executor retries 429/5xx for a block with a
 * retry config and paces itself off this header, so dropping it downgrades a precise wait
 * into blind exponential backoff against an endpoint that just told us how long to wait.
 * `Location` and `Link` identify the resource created by, or the next page of, an
 * accepted request.
 */
const FORWARDED_CONCUR_HEADERS = ['retry-after', 'location', 'link'] as const

/**
 * Pick the {@link FORWARDED_CONCUR_HEADERS} present on a Concur response.
 *
 * Typed structurally rather than as `Headers` so it accepts both a DOM `Headers` and the
 * `SecureFetchHeaders` returned by `secureFetchWithValidation`, which exposes only `get`.
 */
export function forwardedSapConcurHeaders(source: {
  get(name: string): string | null
}): Record<string, string> {
  const forwarded: Record<string, string> = {}
  for (const name of FORWARDED_CONCUR_HEADERS) {
    const value = source.get(name)
    if (value) forwarded[name] = value
  }
  return forwarded
}

/**
 * Turn an outbound-fetch rejection into a message a caller can act on.
 *
 * `secureFetchWithValidation` runs with `maxRedirects: 0`, so any Concur response that is
 * a redirect *with* a `Location` header rejects with `Too many redirects (max: 0)` rather
 * than returning a status. That is a deliberate refusal (the bearer token must never be
 * replayed to another origin), but the bare message reads like an internal fault, so it
 * is restated in terms of what actually happened.
 */
export function describeSapConcurFetchError(error: unknown): string {
  const message = getErrorMessage(error, 'Unknown error')
  if (message.startsWith('Too many redirects')) {
    return 'Concur returned a redirect, which is not followed because the access token must not be replayed to another origin. Check the datacenter/geolocation and the request path.'
  }
  return message
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Message from the legacy nested envelope used by Expense v3 and Travel:
 * `{ Content: { Error: { Message } } }` or `{ Error: { Message } }`.
 */
function legacyEnvelopeMessage(obj: Record<string, unknown>): string | undefined {
  const container = isRecord(obj.Content) ? obj.Content : obj
  const error = isRecord(container.Error) ? container.Error : undefined
  return error ? nonEmptyString(error.Message) : undefined
}

/** URN of the Concur SCIM error extension carrying per-attribute `messages[]`. */
const SCIM_CONCUR_ERROR_URN = 'urn:ietf:params:scim:api:messages:concur:2.0:Error'

/**
 * Render one Budget v4 `errorMessageList` entry (`{ errorType, errorCode, errorMessage }`).
 * `errorType` is kept because it distinguishes a hard `ERROR` from a `WARNING`.
 */
function formatErrorMessageListEntry(entry: unknown): string {
  if (!isRecord(entry)) return String(entry)
  const label = [nonEmptyString(entry.errorType), nonEmptyString(entry.errorCode)]
    .filter(Boolean)
    .join(' ')
  const message = nonEmptyString(entry.errorMessage) ?? ''
  return label ? `[${label}] ${message}`.trim() : message
}

/** Render one Concur SCIM extension message (`{ code, message, schemaPath, type }`). */
function formatScimExtensionMessage(entry: unknown): string {
  if (!isRecord(entry)) return String(entry)
  const code = nonEmptyString(entry.code)
  const message = nonEmptyString(entry.message) ?? ''
  const schemaPath = nonEmptyString(entry.schemaPath)
  const head = code ? `[${code}] ` : ''
  const tail = schemaPath ? ` (${schemaPath})` : ''
  return `${head}${message}${tail}`.trim()
}

function joinNonEmpty(values: unknown[], format: (value: unknown) => string): string | undefined {
  const joined = values.map(format).filter(Boolean).join('; ')
  return joined.length > 0 ? joined : undefined
}

/**
 * Match a Concur error record against the documented shapes, returning `undefined` when
 * none apply so the caller can fall through to its own default.
 *
 * `depth` bounds the single documented level of nesting: Budget Adjustments v4 wraps the
 * same `{ status, errorMessageList }` object under a `message` key, so an object-valued
 * `message` is unwrapped once before the string-valued `message` shape is considered.
 */
function extractFromRecord(obj: Record<string, unknown>, depth: number): string | undefined {
  if (depth === 0 && isRecord(obj.message)) {
    const nested = extractFromRecord(obj.message, depth + 1)
    if (nested) return nested
  }

  const error = nonEmptyString(obj.error)
  if (error) {
    const description = nonEmptyString(obj.error_description)
    const code = obj.code
    const codePrefix = typeof code === 'string' || typeof code === 'number' ? `[${code}] ` : ''
    return `${codePrefix}${error}${description ? `: ${description}` : ''}`
  }

  const errorMessage = nonEmptyString(obj.errorMessage)
  if (errorMessage) {
    const validationErrors = Array.isArray(obj.validationErrors)
      ? obj.validationErrors
          .map((v) => (isRecord(v) ? nonEmptyString(v.message) : undefined))
          .filter((m): m is string => Boolean(m))
      : []
    return validationErrors.length > 0
      ? `${errorMessage}: ${validationErrors.join('; ')}`
      : errorMessage
  }

  if (Array.isArray(obj.errorMessageList) && obj.errorMessageList.length > 0) {
    const joined = joinNonEmpty(obj.errorMessageList, formatErrorMessageListEntry)
    if (joined) return joined
  }

  const detail = nonEmptyString(obj.detail)
  if (detail) {
    const scimType = nonEmptyString(obj.scimType)
    return scimType ? `[${scimType}] ${detail}` : detail
  }

  const scimExtension = obj[SCIM_CONCUR_ERROR_URN]
  if (isRecord(scimExtension) && Array.isArray(scimExtension.messages)) {
    const joined = joinNonEmpty(scimExtension.messages, formatScimExtensionMessage)
    if (joined) return joined
  }

  const message = nonEmptyString(obj.message)
  if (message) return message

  const legacy = legacyEnvelopeMessage(obj)
  if (legacy) return legacy

  if (Array.isArray(obj.errors) && obj.errors.length > 0) {
    return joinNonEmpty(obj.errors, (e) => {
      if (!isRecord(e)) return String(e)
      const code = nonEmptyString(e.errorCode)
      const msg = nonEmptyString(e.errorMessage) ?? ''
      return `${code ? `[${code}] ` : ''}${msg}`.trim()
    })
  }

  return undefined
}

interface ExtractSapConcurErrorOptions {
  /**
   * Cap applied to an unstructured string body before it is surfaced. Set on the token
   * path, where the request body carries credentials an intermediary might echo back.
   * Left unset elsewhere so ordinary API errors surface in full.
   */
  maxRawBodyLength?: number
}

/**
 * Extract a meaningful error message from a Concur error response body, covering the
 * OAuth `{ code, error, error_description }` shape, the Expense v4 `ErrorMessage` schema,
 * the Budget v4 `errorMessageList` shape (including the Budget Adjustments v4 variant
 * that nests it under `message`), the SCIM (Identity v4.1) `detail` shape and its Concur
 * `messages[]` extension, the legacy nested `Content.Error.Message` envelope, and an
 * undocumented `{ errors: [...] }` list kept for tolerance.
 */
export function extractSapConcurError(
  body: unknown,
  status: number,
  options: ExtractSapConcurErrorOptions = {}
): string {
  if (isRecord(body)) {
    const message = extractFromRecord(body, 0)
    if (message) return message
  }
  if (typeof body === 'string' && body.length > 0) {
    return options.maxRawBodyLength === undefined ? body : truncate(body, options.maxRawBodyLength)
  }
  return `Concur request failed with HTTP ${status}`
}
