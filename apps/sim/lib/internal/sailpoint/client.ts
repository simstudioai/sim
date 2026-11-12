import { createHash } from 'node:crypto'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { LRUCache } from 'lru-cache'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import {
  consumeOrCancelBody,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { throttledRetryAfterMs } from '@/lib/credentials/token-service-accounts/errors'

/** API client credentials typed inline on the legacy block. */
export interface SailPointCredentials {
  clientId: string
  clientSecret: string
  tenant: string
}

/** A token minted from a saved SailPoint credential, with the tenant host it was minted for. */
interface SailPointTokenCredentials {
  accessToken: string
  tenant: string
}

export type SailPointAuth = SailPointCredentials | SailPointTokenCredentials

/** Raised when the tenant's token endpoint refuses the exchange, carrying its HTTP status. */
export class SailPointAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The token endpoint's `Retry-After` on a 429 or 503, in milliseconds. */
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'SailPointAuthError'
  }
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

const MAX_FETCH_RETRIES = 4
const MAX_TOKEN_EXCHANGES = 100
const MAX_TOKEN_RESPONSE_BYTES = 1024 * 1024
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000
const TOKEN_EXPIRY_BUFFER_MS = 60_000

/**
 * Access tokens keyed by tenant, client, and secret hash. `fetchMethod`
 * coalesces concurrent exchanges per key and sets each entry's TTL from the
 * provider's `expires_in`. The exchange owns its timeout and ignores
 * cache-driven aborts, so an eviction never fails callers already waiting on
 * it; a caller's own signal only detaches that caller. Because an evicted exchange keeps
 * running, `max` does not bound in-flight exchanges, so `activeTokenExchanges` caps them
 * separately. TTLs run on the wall clock at exact resolution, the same clock as the
 * provider's `expires_in`.
 */
let activeTokenExchanges = 0
const tokenCache = new LRUCache<string, string, SailPointCredentials>({
  max: 100,
  ttlResolution: 0,
  ignoreFetchAbort: true,
  perf: { now: () => Date.now() },
  fetchMethod: async (_key, _stale, { context, options }) => {
    if (activeTokenExchanges >= MAX_TOKEN_EXCHANGES) {
      throw new Error('Too many concurrent SailPoint token exchanges')
    }
    activeTokenExchanges += 1
    try {
      const { token, ttlMs } = await exchangeAccessToken(
        context,
        AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS)
      )
      options.ttl = ttlMs
      return token
    } finally {
      activeTokenExchanges -= 1
    }
  },
})

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

/**
 * Exchanges API client credentials for an access token at a tenant's token
 * endpoint (`client_credentials` grant, credentials in the form body), with
 * redirects refused and up to four backoff retries on 429 (`maxThrottleRetries`).
 * A 429 whose wait (its `Retry-After`, or the backoff when it names none)
 * exceeds `maxThrottleWaitMs` is not retried. A refusal throws
 * {@link SailPointAuthError} with the provider's status, message, and
 * `Retry-After`, even when its error body cannot be read.
 *
 * @see https://developer.sailpoint.com/docs/api/authentication
 */
export async function requestSailPointToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  signal: AbortSignal,
  {
    maxThrottleRetries = MAX_FETCH_RETRIES,
    maxThrottleWaitMs = Number.POSITIVE_INFINITY,
  }: { maxThrottleRetries?: number; maxThrottleWaitMs?: number } = {}
): Promise<{ token: string; expiresInSeconds: number }> {
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
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      cache: 'no-store',
      redirect: 'error',
      signal,
    })

    const throttleWaitMs =
      response.status === 429 && attempt < maxThrottleRetries
        ? backoffWithJitter(attempt + 1, parseRetryAfter(response.headers.get('retry-after')))
        : undefined
    if (throttleWaitMs !== undefined && throttleWaitMs <= maxThrottleWaitMs) {
      await consumeOrCancelBody(response, DEFAULT_MAX_ERROR_BODY_BYTES)
      attempt += 1
      await interruptibleSleep(throttleWaitMs, signal)
      signal?.throwIfAborted()
      continue
    }

    const data = response.ok
      ? await readBoundedBody(response, MAX_TOKEN_RESPONSE_BYTES, signal)
      : await readBoundedBody(response, DEFAULT_MAX_ERROR_BODY_BYTES, signal).catch(() => null)
    signal?.throwIfAborted()
    if (!response.ok) {
      throw new SailPointAuthError(
        getSailPointErrorMessage(data, 'Failed to authenticate with SailPoint'),
        response.status,
        throttledRetryAfterMs(response)
      )
    }
    if (!isRecordLike(data) || typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('SailPoint authentication did not return an access token')
    }

    const parsedExpiry = Number(data.expires_in)
    return {
      token: data.access_token,
      expiresInSeconds: Number.isFinite(parsedExpiry) && parsedExpiry > 0 ? parsedExpiry : 3600,
    }
  }
}

async function exchangeAccessToken(
  credentials: SailPointCredentials,
  signal: AbortSignal
): Promise<{ token: string; ttlMs: number }> {
  const { tokenUrl } = resolveSailPointHosts(credentials.tenant)
  const { token, expiresInSeconds } = await requestSailPointToken(
    tokenUrl,
    credentials.clientId,
    credentials.clientSecret,
    signal
  )
  const bufferMs = Math.min(TOKEN_EXPIRY_BUFFER_MS, expiresInSeconds * 100)
  // lru-cache reads a TTL of 0 as "never expires", so keep at least 1ms.
  return { token, ttlMs: Math.max(Math.floor(expiresInSeconds * 1000 - bufferMs), 1) }
}

export function invalidateSailPointToken(credentials: SailPointCredentials): void {
  tokenCache.delete(credentialsCacheKey(credentials))
}

export async function getSailPointAccessToken(
  credentials: SailPointCredentials,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const token = await waitForPromiseWithSignal(
    tokenCache.fetch(credentialsCacheKey(credentials), { context: credentials }),
    signal
  )
  if (token === undefined)
    throw new Error('SailPoint authentication did not return an access token')
  return token
}

/**
 * Sends one authenticated request to the tenant. A saved credential's token
 * (`accessToken`) is sent as is; inline credentials use a cached token and,
 * when the tenant rejects it, mint once more and retry.
 */
export async function sailpointFetch(
  credentials: SailPointAuth,
  buildRequest: (hosts: SailPointHosts) => { init: RequestInit; url: string },
  options: { maxRetries?: number; signal?: AbortSignal } = {}
): Promise<SailPointFetchResult> {
  const maxRetries = Math.min(Math.max(options.maxRetries ?? MAX_FETCH_RETRIES, 0), 10)
  const hosts = resolveSailPointHosts(credentials.tenant)
  let attempt = 0
  let refreshedOn401 = false

  while (true) {
    options.signal?.throwIfAborted()
    const inline = 'accessToken' in credentials ? undefined : credentials
    const token =
      'accessToken' in credentials
        ? credentials.accessToken
        : await getSailPointAccessToken(credentials, options.signal)
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

    if (response.status === 401 && inline && !refreshedOn401) {
      await consumeOrCancelBody(response, DEFAULT_MAX_ERROR_BODY_BYTES)
      invalidateSailPointToken(inline)
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
