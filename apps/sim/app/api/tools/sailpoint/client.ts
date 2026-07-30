import { sleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'

/**
 * Shared server-side SailPoint client used by the SailPoint tool routes. Handles per-tenant host
 * resolution, the client-credentials token exchange (cached in-process), and a fetch wrapper that
 * refreshes the token on a 401 and backs off on a 429 honoring `Retry-After`.
 *
 * SailPoint enforces 100 requests per client_id per API version per 10 seconds, so a stateless
 * per-call token exchange would double every operation against that budget - the cache avoids it.
 */

export type SailPointApiVersion = 'v2025' | 'v2024' | 'v3'

const SUPPORTED_VERSIONS: readonly SailPointApiVersion[] = ['v2025', 'v2024', 'v3']

export interface SailPointServerCredentials {
  clientId: string
  clientSecret: string
  tenant: string
  apiVersion: SailPointApiVersion
}

export interface SailPointHosts {
  /** `https://{host}/{apiVersion}` */
  apiBaseUrl: string
  /** `https://{host}/oauth/token` */
  tokenUrl: string
  host: string
}

export interface SailPointFetchResult {
  ok: boolean
  status: number
  data: unknown
  headers: Headers
}

/** Normalizes an incoming version string to a supported value, defaulting to v2025. */
export function normalizeApiVersion(value: string | undefined | null): SailPointApiVersion {
  if (value && SUPPORTED_VERSIONS.includes(value as SailPointApiVersion)) {
    return value as SailPointApiVersion
  }
  return 'v2025'
}

/**
 * Resolves the API + token hosts for a tenant. Accepts either a bare tenant subdomain (`acme`) or a
 * full host/URL (`https://acme.api.identitynow.com`, `acme.api.identitynow.com`), stripping any
 * protocol, path, or version segment the caller may have included.
 */
export function resolveSailPointHosts(
  tenant: string,
  apiVersion: SailPointApiVersion
): SailPointHosts {
  let host = tenant.trim().replace(/^https?:\/\//i, '')
  host = host.replace(/[/?#].*$/, '').replace(/\.+$/, '')
  if (!host.includes('.')) {
    host = `${host}.api.identitynow.com`
  }
  return {
    host,
    apiBaseUrl: `https://${host}/${apiVersion}`,
    tokenUrl: `https://${host}/oauth/token`,
  }
}

/** Extracts a human-readable message from a SailPoint error body (ISC `messages[]` or OAuth `error`). */
export function getSailPointErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'string') return data || fallback
  if (!isRecordLike(data)) return fallback

  if (Array.isArray(data.messages) && data.messages.length > 0) {
    const first = data.messages[0]
    if (isRecordLike(first) && typeof first.text === 'string' && first.text) {
      const trackingId = typeof data.trackingId === 'string' ? data.trackingId : null
      return trackingId ? `${first.text} (trackingId: ${trackingId})` : first.text
    }
  }

  if (typeof data.error_description === 'string' && data.error_description)
    return data.error_description
  if (typeof data.message === 'string' && data.message) return data.message
  if (typeof data.error === 'string' && data.error) return data.error
  return fallback
}

interface CachedToken {
  token: string
  expiresAt: number
}

const TOKEN_EXPIRY_BUFFER_MS = 60_000
const tokenCache = new Map<string, CachedToken>()

function cacheKey(creds: SailPointServerCredentials): string {
  return `${creds.tenant}:${creds.clientId}:${creds.apiVersion}`
}

/** Drops any cached token for these credentials so the next call re-exchanges. */
export function invalidateSailPointToken(creds: SailPointServerCredentials): void {
  tokenCache.delete(cacheKey(creds))
}

/** Returns a cached bearer token or performs a client-credentials exchange and caches it. */
export async function getSailPointAccessToken(creds: SailPointServerCredentials): Promise<string> {
  const key = cacheKey(creds)
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token
  }

  const { tokenUrl } = resolveSailPointHosts(creds.tenant, creds.apiVersion)
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }).toString(),
    cache: 'no-store',
  })

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(getSailPointErrorMessage(data, 'Failed to authenticate with SailPoint'))
  }
  if (!isRecordLike(data) || typeof data.access_token !== 'string') {
    throw new Error('SailPoint authentication did not return an access token')
  }

  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600
  tokenCache.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(expiresInSec * 1000 - TOKEN_EXPIRY_BUFFER_MS, 0),
  })
  return data.access_token
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Performs an authenticated SailPoint request, refreshing the token once on a 401 and backing off on
 * a 429 (honoring `Retry-After`). `buildRequest` receives the current token + resolved hosts so it can
 * compose the URL/body; the bearer header is applied automatically.
 */
export async function sailpointFetch(
  creds: SailPointServerCredentials,
  buildRequest: (token: string, hosts: SailPointHosts) => { url: string; init: RequestInit },
  options: { maxRetries?: number } = {}
): Promise<SailPointFetchResult> {
  const maxRetries = options.maxRetries ?? 4
  const hosts = resolveSailPointHosts(creds.tenant, creds.apiVersion)
  let attempt = 0
  let refreshedOn401 = false

  while (true) {
    const token = await getSailPointAccessToken(creds)
    const { url, init } = buildRequest(token, hosts)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')

    const response = await fetch(url, { ...init, headers, cache: 'no-store' })

    if (response.status === 401 && !refreshedOn401) {
      invalidateSailPointToken(creds)
      refreshedOn401 = true
      continue
    }

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      attempt += 1
      await sleep(backoffWithJitter(attempt, retryAfterMs))
      continue
    }

    const data = await parseResponseBody(response)
    return { ok: response.ok, status: response.status, data, headers: response.headers }
  }
}

/** Reads the `X-Total-Count` header as a number, or null when absent/unparseable. */
export function readTotalCount(headers: Headers): number | null {
  const raw = headers.get('x-total-count')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}
