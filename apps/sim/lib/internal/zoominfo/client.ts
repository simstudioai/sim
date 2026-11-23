import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { throttledRetryAfterMs } from '@/lib/credentials/token-service-accounts/errors'
import {
  assertSafeZoomInfoUrl,
  ZOOMINFO_API_BASE,
  ZOOMINFO_TOKEN_URL,
  type ZoomInfoAuth,
  type ZoomInfoProviderRequest,
} from '@/lib/internal/zoominfo/schema'

const logger = createLogger('ZoomInfoClient')

const OUTBOUND_FETCH_TIMEOUT_MS = 30_000
const MAX_TOKEN_RESPONSE_BYTES = 256 * 1024
const TOKEN_CACHE_MAX_ENTRIES = 500
const TOKEN_SAFETY_WINDOW_MS = 60_000
/** Lifetime assumed when a token response carries no usable `expires_in`. */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3300

interface CachedToken {
  accessToken: string
  expiresAt: number
}

interface ZoomInfoInvocation {
  status: number
  body: unknown
}

const TOKEN_CACHE = new Map<string, CachedToken>()

export class ZoomInfoOperationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerStatus?: number
  ) {
    super(message)
    this.name = 'ZoomInfoOperationError'
  }
}

/**
 * Raised when ZoomInfo's token endpoint refuses an exchange. Answers the
 * operation exactly as every token failure always has (HTTP 500 naming the
 * provider status), and carries that status for the saved-credential minter.
 */
export class ZoomInfoTokenError extends ZoomInfoOperationError {
  constructor(
    readonly tokenStatus: number,
    /** The token endpoint's `Retry-After` on a 429 or 503, in milliseconds. */
    readonly retryAfterMs?: number
  ) {
    super(`ZoomInfo token request failed: HTTP ${tokenStatus}`, 500)
    this.name = 'ZoomInfoTokenError'
  }
}

interface ZoomInfoClientCredentials {
  clientId: string
  clientSecret: string
}

/**
 * The token a saved credential minted, or the inline client credentials to
 * mint one with. Refuses input carrying neither.
 */
function resolveZoomInfoAuth(
  auth: ZoomInfoAuth
): { accessToken: string } | { credentials: ZoomInfoClientCredentials } {
  if (auth.accessToken) return { accessToken: auth.accessToken }
  if (!auth.clientId) throw new ZoomInfoOperationError('clientId is required', 400)
  if (!auth.clientSecret) throw new ZoomInfoOperationError('clientSecret is required', 400)
  return { credentials: { clientId: auth.clientId, clientSecret: auth.clientSecret } }
}

function tokenCacheKey(auth: ZoomInfoClientCredentials): string {
  const secretHash = createHash('sha256').update(auth.clientSecret).digest('hex').slice(0, 16)
  return `${auth.clientId}::${secretHash}`
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

/**
 * Exchanges client credentials for an access token with the client
 * credentials grant at ZoomInfo's token endpoint, credentials in HTTP Basic
 * auth as ZoomInfo recommends, redirects refused. A refusal throws
 * {@link ZoomInfoTokenError}.
 *
 * @see https://docs.zoominfo.com/docs/client-credentials-flow
 */
export async function requestZoomInfoToken(
  auth: ZoomInfoClientCredentials,
  options: { requestId?: string; signal?: AbortSignal } = {}
): Promise<{ accessToken: string; expiresInSeconds: number; scope?: string }> {
  const { requestId, signal } = options
  signal?.throwIfAborted()
  const tokenUrl = assertSafeZoomInfoUrl(ZOOMINFO_TOKEN_URL, 'tokenUrl').toString()
  const basic = Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString('base64')
  const response = await secureFetchWithValidation(
    tokenUrl,
    {
      profile: 'configuredEndpoint',
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_TOKEN_RESPONSE_BYTES,
      maxRedirects: 0,
      signal,
    },
    'tokenUrl'
  )
  signal?.throwIfAborted()

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn('ZoomInfo token fetch failed', { requestId, status: response.status, error: text })
    throw new ZoomInfoTokenError(response.status, throttledRetryAfterMs(response))
  }
  const data: unknown = await response.json()
  if (!isRecordLike(data) || typeof data.access_token !== 'string' || !data.access_token.trim()) {
    throw new ZoomInfoOperationError('ZoomInfo token response missing access_token', 500)
  }
  return {
    accessToken: data.access_token,
    expiresInSeconds:
      typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
        ? data.expires_in
        : DEFAULT_TOKEN_LIFETIME_SECONDS,
    ...(typeof data.scope === 'string' ? { scope: data.scope } : {}),
  }
}

async function fetchAccessToken(
  auth: ZoomInfoClientCredentials,
  requestId: string,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const cacheKey = tokenCacheKey(auth)
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return cached.accessToken
  }

  const { accessToken, expiresInSeconds } = await requestZoomInfoToken(auth, {
    requestId,
    signal,
  })
  rememberToken(cacheKey, { accessToken, expiresAt: Date.now() + expiresInSeconds * 1000 })
  return accessToken
}

function buildApiUrl(input: ZoomInfoProviderRequest): string {
  const subPath = input.path.startsWith('/') ? input.path : `/${input.path}`
  const url = `${ZOOMINFO_API_BASE}${subPath}`
  if (!input.query || Object.keys(input.query).length === 0) return url
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(input.query)) search.append(key, String(value))
  const queryString = search.toString()
  if (!queryString) return url
  return url.includes('?') ? `${url}&${queryString}` : `${url}?${queryString}`
}

function extractZoomInfoError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (obj.error && typeof obj.error === 'object') {
      const error = obj.error as Record<string, unknown>
      const message = typeof error.message === 'string' ? error.message : ''
      const code = typeof error.code === 'string' ? error.code : ''
      if (message) return code ? `[${code}] ${message}` : message
    }
    if (typeof obj.error === 'string' && obj.error.length > 0) {
      const description =
        typeof obj.error_description === 'string' ? `: ${obj.error_description}` : ''
      return `${obj.error}${description}`
    }
    if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      return obj.errors
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return String(entry)
          const error = entry as Record<string, unknown>
          const title = typeof error.title === 'string' ? error.title : ''
          const detail = typeof error.detail === 'string' ? `: ${error.detail}` : ''
          return `${title}${detail}`.trim()
        })
        .filter(Boolean)
        .join('; ')
    }
  }
  if (typeof body === 'string' && body.length > 0) return body
  return `ZoomInfo request failed with HTTP ${status}`
}

async function invokeZoomInfo(
  input: ZoomInfoProviderRequest,
  accessToken: string,
  signal?: AbortSignal
): Promise<ZoomInfoInvocation> {
  const url = assertSafeZoomInfoUrl(buildApiUrl(input), 'apiUrl').toString()
  const hasBody = input.body !== undefined && input.body !== null
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
  if (hasBody) headers['Content-Type'] = 'application/json'
  const response = await secureFetchWithValidation(
    url,
    {
      profile: 'configuredEndpoint',
      method: input.method,
      headers,
      body: hasBody
        ? typeof input.body === 'string'
          ? input.body
          : JSON.stringify(input.body)
        : undefined,
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      maxRedirects: 0,
      signal,
    },
    'apiUrl'
  )
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
  return { status: response.status, body }
}

export async function requestZoomInfo(
  input: ZoomInfoProviderRequest,
  requestId: string,
  signal?: AbortSignal
): Promise<{ status: number; data: unknown }> {
  const auth = resolveZoomInfoAuth(input)
  const accessToken =
    'accessToken' in auth
      ? auth.accessToken
      : await fetchAccessToken(auth.credentials, requestId, signal)
  const invocation = await invokeZoomInfo(input, accessToken, signal)
  if (invocation.status < 200 || invocation.status >= 300) {
    throw new ZoomInfoOperationError(
      extractZoomInfoError(invocation.body, invocation.status),
      invocation.status,
      invocation.status
    )
  }
  return { status: invocation.status, data: invocation.status === 204 ? null : invocation.body }
}
