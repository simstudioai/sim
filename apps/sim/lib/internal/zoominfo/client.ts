import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
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

function tokenCacheKey(auth: ZoomInfoAuth): string {
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

async function fetchAccessToken(
  auth: ZoomInfoAuth,
  requestId: string,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const cacheKey = tokenCacheKey(auth)
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && cached.expiresAt - TOKEN_SAFETY_WINDOW_MS > Date.now()) {
    return cached.accessToken
  }

  const tokenUrl = assertSafeZoomInfoUrl(ZOOMINFO_TOKEN_URL, 'tokenUrl').toString()
  const basic = Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString('base64')
  const response = await secureFetchWithValidation(
    tokenUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_TOKEN_RESPONSE_BYTES,
      signal,
    },
    'tokenUrl'
  )
  signal?.throwIfAborted()

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    logger.warn('ZoomInfo token fetch failed', { requestId, status: response.status, error: text })
    throw new ZoomInfoOperationError(`ZoomInfo token request failed: HTTP ${response.status}`, 500)
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) {
    throw new ZoomInfoOperationError('ZoomInfo token response missing access_token', 500)
  }
  rememberToken(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3300) * 1000,
  })
  return data.access_token
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
      method: input.method,
      headers,
      body: hasBody
        ? typeof input.body === 'string'
          ? input.body
          : JSON.stringify(input.body)
        : undefined,
      timeout: OUTBOUND_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
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
  const accessToken = await fetchAccessToken(input, requestId, signal)
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
