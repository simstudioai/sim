import {
  type PinnedConnectionPool,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import type { NativeClient } from '@/lib/sim-search/live/types'
import { isGoogleQuotaReason } from '@/connectors/google-workspace/api-errors'

export class NativeSearchError extends Error {
  constructor(
    readonly status: 'reconnect' | 'rate_limited' | 'unavailable' | 'timeout',
    message: string,
    readonly retryAfterSeconds?: number,
    /** The provider's HTTP status, when the failure is a plain non-success response. */
    readonly httpStatus?: number
  ) {
    super(message)
  }
}

/** Provider requests one native search may make, including discovery and verification. */
export const NATIVE_SEARCH_REQUEST_BUDGET = 30

/** Tokens only go to a code-selected provider origin; redirects never carry credentials. */
export function createNativeClient(input: {
  origin: string
  accessToken: string
  signal: AbortSignal
  /** Reuses connections across this client's requests; the caller owns its lifetime. */
  pool?: PinnedConnectionPool
  /** Requests this client may make; defaults to one search's budget. */
  requestBudget?: number
}): NativeClient {
  let requests = 0
  async function request(
    path: string,
    options?: {
      query?: Record<string, string | string[]>
      body?: unknown
      googleService?: 'sheets'
    }
  ) {
    input.signal.throwIfAborted()
    if (++requests > (input.requestBudget ?? NATIVE_SEARCH_REQUEST_BUDGET))
      throw new NativeSearchError('unavailable', 'Request budget reached. Narrow the query.')
    const url = new URL(input.origin)
    if (options?.googleService === 'sheets') {
      if (url.origin !== 'https://www.googleapis.com') throw new Error('Invalid Google service')
      url.hostname = 'sheets.googleapis.com'
    }
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
      throw new Error('Invalid provider path')
    url.pathname = path
    for (const [key, value] of Object.entries(options?.query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item)
    }
    const response = await secureFetchWithValidation(url.toString(), {
      profile: 'configuredEndpoint',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept:
          url.hostname === 'api.github.com'
            ? 'application/vnd.github.text-match+json'
            : 'application/json',
        ...(url.hostname === 'api.github.com' ? { 'X-GitHub-Api-Version': '2026-03-10' } : {}),
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      method: options?.body ? 'POST' : 'GET',
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
      signal: input.signal,
      timeout: 10_000,
      maxResponseBytes: 4 * 1024 * 1024,
      maxRedirects: 0,
      acceptCompressed: true,
      connectionPool: input.pool,
    })
    if (!response.ok) {
      /** Reading the small error body also returns a pooled connection for reuse. */
      let quotaExceeded = false
      if (response.status === 403 && url.hostname.endsWith('.googleapis.com'))
        quotaExceeded = isGoogleQuotaError(await response.json().catch(() => null))
      else await response.text().catch(() => '')
      if (
        response.status === 429 ||
        quotaExceeded ||
        (response.status === 403 &&
          (response.headers.get('retry-after') !== null ||
            response.headers.get('x-ratelimit-remaining') === '0'))
      ) {
        const retry = Number(response.headers.get('retry-after'))
        const reset = Number(response.headers.get('x-ratelimit-reset'))
        const seconds = retry > 0 ? retry : reset > 0 ? Math.ceil(reset - Date.now() / 1000) : 0
        throw new NativeSearchError(
          'rate_limited',
          'Provider rate limit reached. Try again later.',
          Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
        )
      }
      if (response.status === 401 || response.status === 403)
        throw new NativeSearchError(
          'reconnect',
          url.hostname === 'api.github.com'
            ? 'GitHub denied access. Reconnect your account and check that the GitHub App has access to this repository, with read permissions for Contents, Issues, and Pull requests.'
            : 'The provider denied access. Reconnect your account with search and read permissions.'
        )
      throw new NativeSearchError(
        'unavailable',
        response.status === 400 || response.status === 422
          ? `The provider rejected this query (${response.status}). Check its native query syntax and supported search scope.`
          : `Provider request failed (${response.status}).`,
        undefined,
        response.status
      )
    }
    return response
  }
  return withJsonMemo({
    async json(path, options) {
      return (await request(path, options)).json()
    },
    async text(path, query) {
      return (await request(path, { query })).text()
    },
  })
}

/**
 * Answers a repeated `memo` GET from the client's earlier response, including a failure, so a
 * rate-limited endpoint is not requested again. A client lives for one search or read, so a
 * memoized response never outlives the request that authorized it.
 */
export function withJsonMemo(client: NativeClient): NativeClient {
  const memo = new Map<string, Promise<unknown>>()
  return {
    ...client,
    json(...request) {
      const [path, options] = request
      if (!options?.memo || options.body) return client.json(...request)
      const key = JSON.stringify([path, options.query, options.googleService])
      let pending = memo.get(key)
      if (!pending) {
        pending = client.json(...request)
        memo.set(key, pending)
      }
      return pending
    },
  }
}

/**
 * Google reports quota exhaustion as a 403 whose body names the reason, without the rate-limit
 * headers other providers send. Only the reason codes are read; the body is never surfaced.
 */
function isGoogleQuotaError(body: unknown): boolean {
  const error = object(object(body).error)
  return (
    error.status === 'RESOURCE_EXHAUSTED' ||
    [...array(error.errors), ...array(error.details)].some((entry) =>
      isGoogleQuotaReason(string(entry.reason))
    )
  )
}

/** Only extract typed fields from untrusted provider JSON. */
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}
export function string(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}
export function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : []
}
export function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textContent).filter(Boolean).join('\n')
  if (!value || typeof value !== 'object') return ''
  const node = object(value)
  return string(node.text) || textContent(node.content)
}
export const segment = (value: string) => encodeURIComponent(value)
