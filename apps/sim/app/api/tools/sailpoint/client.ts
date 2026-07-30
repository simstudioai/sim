import { createHash } from 'node:crypto'
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
 * Allowed SailPoint API host suffixes. A user-supplied full host must end with one of these; this
 * prevents SSRF and PAT-secret disclosure by ensuring the client-credentials request (which carries
 * `client_secret`) can only ever be sent to a SailPoint tenant host, never an arbitrary destination.
 */
const ALLOWED_HOST_SUFFIXES = ['.api.identitynow.com', '.api.identitynowgov.com'] as const

/**
 * Resolves the API + token hosts for a tenant. Accepts either a bare tenant subdomain (`acme` →
 * `acme.api.identitynow.com`) or a full SailPoint host/URL (`https://acme.api.identitynow.com`),
 * stripping any protocol, path, or version segment. Throws when the resolved host is not a SailPoint
 * identitynow.com host - the credentials must never be posted to an attacker-controlled or internal
 * host.
 */
export function resolveSailPointHosts(
  tenant: string,
  apiVersion: SailPointApiVersion
): SailPointHosts {
  let host = tenant.trim().replace(/^https?:\/\//i, '')
  host = host
    .replace(/[/?#].*$/, '')
    .replace(/\.+$/, '')
    .toLowerCase()

  if (!host) {
    throw new Error('SailPoint tenant is required')
  }

  if (host.includes('.')) {
    const isAllowed =
      /^[a-z0-9.-]+$/.test(host) && ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
    if (!isAllowed) {
      throw new Error(
        `SailPoint host "${host}" is not an allowed identitynow.com host. Enter your tenant name (e.g. "acme") or a full *.api.identitynow.com host.`
      )
    }
  } else {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(host)) {
      throw new Error(`Invalid SailPoint tenant "${tenant}"`)
    }
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
const MAX_FETCH_RETRIES = 4
const tokenCache = new Map<string, CachedToken>()

function cacheKey(creds: SailPointServerCredentials): string {
  const { host } = resolveSailPointHosts(creds.tenant, creds.apiVersion)
  // Bind the cache entry to the exact client_secret (hashed) so a caller with a matching
  // tenant/clientId but the wrong secret can never reuse another principal's cached token - a
  // mismatched secret produces a different key, misses the cache, and fails the token exchange.
  const secretHash = createHash('sha256').update(creds.clientSecret).digest('hex').slice(0, 16)
  return `${host}:${creds.clientId}:${creds.apiVersion}:${secretHash}`
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

  let attempt = 0
  let response: Response
  while (true) {
    response = await fetch(tokenUrl, {
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
    // The token endpoint shares SailPoint's per-client_id rate limit, so back off on a 429 too.
    if (response.status === 429 && attempt < MAX_FETCH_RETRIES) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      attempt += 1
      await sleep(backoffWithJitter(attempt, retryAfterMs))
      continue
    }
    break
  }

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(getSailPointErrorMessage(data, 'Failed to authenticate with SailPoint'))
  }
  if (!isRecordLike(data) || typeof data.access_token !== 'string') {
    throw new Error('SailPoint authentication did not return an access token')
  }

  const parsedExpiry = Number(data.expires_in)
  const expiresInSec = Number.isFinite(parsedExpiry) && parsedExpiry > 0 ? parsedExpiry : 3600
  // Use the smaller of the 60s buffer and 10% of the lifetime so a short-lived token (expires_in
  // under ~60s) still gets cached for most of its life instead of expiring immediately.
  const bufferMs = Math.min(TOKEN_EXPIRY_BUFFER_MS, expiresInSec * 100)
  tokenCache.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(expiresInSec * 1000 - bufferMs, 0),
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
  const maxRetries = options.maxRetries ?? MAX_FETCH_RETRIES
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
