import { createHash } from 'node:crypto'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import {
  consumeOrCancelBody,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'

export interface SailPointCredentials {
  clientId: string
  clientSecret: string
  tenant: string
}

export interface SailPointHosts {
  apiBaseUrl: string
  host: string
  tokenUrl: string
}

export interface SailPointFetchResult {
  data: unknown
  headers: Headers
  ok: boolean
  status: number
}

interface CachedToken {
  expiresAt: number
  token: string
}

const MAX_FETCH_RETRIES = 4
const MAX_TOKEN_CACHE_ENTRIES = 100
const MAX_TOKEN_EXCHANGES = 100
const MAX_TOKEN_RESPONSE_BYTES = 1024 * 1024
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000
const TOKEN_EXPIRY_BUFFER_MS = 60_000
const tokenCache = new Map<string, CachedToken>()
const tokenExchanges = new Map<string, Promise<string>>()

async function waitForPromiseWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()

  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function resolveSailPointHosts(tenant: string): SailPointHosts {
  let host = tenant.trim().replace(/^https?:\/\//i, '')
  host = host
    .replace(/[/?#].*$/, '')
    .replace(/\.+$/, '')
    .toLowerCase()

  if (!host) throw new Error('SailPoint tenant is required')
  if (!host.includes('.')) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(host)) {
      throw new Error(`Invalid SailPoint tenant "${tenant}"`)
    }
    host = `${host}.api.identitynow.com`
  }

  const suffix = ['.api.identitynow.com', '.api.identitynowgov.com'].find((candidate) =>
    host.endsWith(candidate)
  )
  const tenantPrefix = suffix ? host.slice(0, -suffix.length) : ''
  if (!suffix || !tenantPrefix || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(tenantPrefix)) {
    throw new Error(
      `SailPoint host "${host}" is not an allowed Identity Security Cloud tenant host`
    )
  }

  return {
    apiBaseUrl: `https://${host}`,
    host,
    tokenUrl: `https://${host}/oauth/token`,
  }
}

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
  if (typeof data.error_description === 'string' && data.error_description) {
    return data.error_description
  }
  if (typeof data.message === 'string' && data.message) return data.message
  if (typeof data.error === 'string' && data.error) return data.error
  return fallback
}

function credentialsCacheKey(credentials: SailPointCredentials): string {
  const { host } = resolveSailPointHosts(credentials.tenant)
  const secretHash = createHash('sha256').update(credentials.clientSecret).digest('hex')
  return `${host}:${credentials.clientId}:${secretHash}`
}

function pruneTokenCache(now: number): void {
  for (const [key, value] of tokenCache) {
    if (value.expiresAt <= now) tokenCache.delete(key)
  }
  while (tokenCache.size >= MAX_TOKEN_CACHE_ENTRIES) {
    const oldest = tokenCache.keys().next().value
    if (typeof oldest !== 'string') break
    tokenCache.delete(oldest)
  }
}

function cacheToken(key: string, token: CachedToken): void {
  pruneTokenCache(Date.now())
  tokenCache.delete(key)
  tokenCache.set(key, token)
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<unknown> {
  if (response.status === 204) return null
  const text = await readResponseTextWithLimit(response, {
    maxBytes,
    label: 'SailPoint response body',
    signal,
  })
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function exchangeAccessToken(
  credentials: SailPointCredentials,
  signal?: AbortSignal
): Promise<string> {
  const { tokenUrl } = resolveSailPointHosts(credentials.tenant)
  let attempt = 0

  while (true) {
    signal?.throwIfAborted()
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }).toString(),
      cache: 'no-store',
      redirect: 'error',
      signal,
    })

    if (response.status === 429 && attempt < MAX_FETCH_RETRIES) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      await consumeOrCancelBody(response, DEFAULT_MAX_ERROR_BODY_BYTES)
      attempt += 1
      await interruptibleSleep(backoffWithJitter(attempt, retryAfterMs), signal)
      signal?.throwIfAborted()
      continue
    }

    const data = await readBoundedBody(
      response,
      response.ok ? MAX_TOKEN_RESPONSE_BYTES : DEFAULT_MAX_ERROR_BODY_BYTES,
      signal
    )
    if (!response.ok) {
      throw new Error(getSailPointErrorMessage(data, 'Failed to authenticate with SailPoint'))
    }
    if (!isRecordLike(data) || typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('SailPoint authentication did not return an access token')
    }

    const parsedExpiry = Number(data.expires_in)
    const expiresInSeconds = Number.isFinite(parsedExpiry) && parsedExpiry > 0 ? parsedExpiry : 3600
    const bufferMs = Math.min(TOKEN_EXPIRY_BUFFER_MS, expiresInSeconds * 100)
    const key = credentialsCacheKey(credentials)
    cacheToken(key, {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(expiresInSeconds * 1000 - bufferMs, 0),
    })
    return data.access_token
  }
}

export function invalidateSailPointToken(credentials: SailPointCredentials): void {
  tokenCache.delete(credentialsCacheKey(credentials))
}

export async function getSailPointAccessToken(
  credentials: SailPointCredentials,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const key = credentialsCacheKey(credentials)
  const now = Date.now()
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > now) {
    tokenCache.delete(key)
    tokenCache.set(key, cached)
    return cached.token
  }
  if (cached) tokenCache.delete(key)

  const existing = tokenExchanges.get(key)
  if (existing) return waitForPromiseWithSignal(existing, signal)
  if (tokenExchanges.size >= MAX_TOKEN_EXCHANGES) {
    throw new Error('Too many concurrent SailPoint token exchanges')
  }

  const exchange = exchangeAccessToken(
    credentials,
    AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS)
  ).finally(() => {
    tokenExchanges.delete(key)
  })
  tokenExchanges.set(key, exchange)
  return waitForPromiseWithSignal(exchange, signal)
}

export async function sailpointFetch(
  credentials: SailPointCredentials,
  buildRequest: (hosts: SailPointHosts) => { init: RequestInit; url: string },
  options: { maxRetries?: number; signal?: AbortSignal } = {}
): Promise<SailPointFetchResult> {
  const maxRetries = Math.min(Math.max(options.maxRetries ?? MAX_FETCH_RETRIES, 0), 10)
  const hosts = resolveSailPointHosts(credentials.tenant)
  let attempt = 0
  let refreshedOn401 = false

  while (true) {
    options.signal?.throwIfAborted()
    const token = await getSailPointAccessToken(credentials, options.signal)
    const { init, url } = buildRequest(hosts)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')

    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers,
      redirect: 'error',
      signal: options.signal,
    })

    if (response.status === 401 && !refreshedOn401) {
      await consumeOrCancelBody(response, DEFAULT_MAX_ERROR_BODY_BYTES)
      invalidateSailPointToken(credentials)
      refreshedOn401 = true
      continue
    }
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      await consumeOrCancelBody(response, DEFAULT_MAX_ERROR_BODY_BYTES)
      attempt += 1
      await interruptibleSleep(backoffWithJitter(attempt, retryAfterMs), options.signal)
      options.signal?.throwIfAborted()
      continue
    }

    const data = await readBoundedBody(
      response,
      response.ok ? MAX_JSON_API_RESPONSE_BYTES : DEFAULT_MAX_ERROR_BODY_BYTES,
      options.signal
    )
    return {
      data,
      headers: response.headers,
      ok: response.ok,
      status: response.status,
    }
  }
}

export function readTotalCount(headers: Headers): number | null {
  const raw = headers.get('x-total-count')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

/** Clears process-local authentication state for deterministic tests. */
export function clearSailPointTokenStateForTests(): void {
  tokenCache.clear()
  tokenExchanges.clear()
}

/** Returns cache sizes for deterministic boundary tests. */
export function getSailPointTokenStateForTests(): { cacheSize: number; exchangeSize: number } {
  return { cacheSize: tokenCache.size, exchangeSize: tokenExchanges.size }
}
