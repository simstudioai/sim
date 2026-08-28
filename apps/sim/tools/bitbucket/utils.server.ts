import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import {
  createPinnedFetchWithDispatcher,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  type BitbucketPullRequestRedirectKind,
  validateBitbucketPullRequestRedirect,
} from '@/tools/bitbucket/utils'

function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

const BITBUCKET_READ_MAX_ATTEMPTS = 3
const BITBUCKET_RETRY_BASE_MS = 500
const BITBUCKET_RETRY_MAX_MS = 30_000

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError')
}

function retryableTransportError(error: unknown): boolean {
  if (isPayloadSizeLimitError(error)) return false
  if (!(error instanceof Error) || error.name === 'AbortError') return false
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNABORTED') return true
  const message = error.message.toLowerCase()
  return message.includes('timeout') || message.includes('timed out')
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await sleep(delayMs)
    return
  }
  if (signal.aborted) throw abortError(signal)

  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([sleep(delayMs), aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function retryDelayMs(attempt: number, retryAfter: string | null): number | null {
  const retryAfterMs = parseRetryAfter(retryAfter, Number.POSITIVE_INFINITY)
  if (retryAfterMs !== null && retryAfterMs > BITBUCKET_RETRY_MAX_MS) return null
  return backoffWithJitter(attempt, retryAfterMs, {
    baseMs: BITBUCKET_RETRY_BASE_MS,
    maxMs: BITBUCKET_RETRY_MAX_MS,
  })
}

/**
 * Executes a bounded, DNS-pinned Bitbucket read. Redirect targets are validated
 * and pinned by the shared transport; callers can drop authorization for media
 * redirects without trusting a destination hostname.
 */
export async function secureBitbucketRead(
  url: string,
  headers: Record<string, string>,
  maxResponseBytes: number,
  options: {
    stripAuthOnRedirect?: boolean
    maxRedirects?: number
    signal?: AbortSignal
  } = {}
): Promise<Response> {
  const validation = await validateUrlWithDNS(url, 'bitbucketUrl', 'configuredEndpoint')
  if (!validation.isValid || !validation.resolvedIP) {
    throw new Error(`Invalid Bitbucket URL: ${validation.error ?? 'DNS resolution failed'}`)
  }

  for (let attempt = 1; attempt <= BITBUCKET_READ_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await secureFetchWithPinnedIP(url, validation.resolvedIP, {
        profile: 'configuredEndpoint',
        method: 'GET',
        headers,
        maxResponseBytes,
        stripAuthOnRedirect: options.stripAuthOnRedirect,
        maxRedirects: options.maxRedirects,
        signal: options.signal,
      })
      if (retryableStatus(response.status) && attempt < BITBUCKET_READ_MAX_ATTEMPTS) {
        const delayMs = retryDelayMs(attempt, response.headers.get('retry-after'))
        if (delayMs === null) {
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers.toRecord(),
          })
        }
        await response.body?.cancel()
        await waitForRetry(delayMs, options.signal)
        continue
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers.toRecord(),
      })
    } catch (error) {
      if (
        options.signal?.aborted ||
        attempt === BITBUCKET_READ_MAX_ATTEMPTS ||
        !retryableTransportError(error)
      ) {
        throw error
      }
      await waitForRetry(retryDelayMs(attempt, null)!, options.signal)
    }
  }
  throw new Error('Bitbucket read failed')
}

/**
 * Resolves the documented PR-to-repository redirect without allowing the
 * bearer-authenticated request to follow an unvalidated Location.
 */
export async function resolveBitbucketPullRequestRedirect(
  initialUrl: string,
  workspaceSlug: string,
  repoSlug: string,
  kind: BitbucketPullRequestRedirectKind,
  headers: Record<string, string>,
  options: {
    signal?: AbortSignal
    targetQuery?: Record<string, string>
  } = {}
): Promise<string> {
  const initialValidation = await validateUrlWithDNS(
    initialUrl,
    'bitbucketPullRequestUrl',
    'configuredEndpoint'
  )
  if (!initialValidation.isValid || !initialValidation.resolvedIP) {
    throw new Error(
      `Invalid Bitbucket pull request URL: ${initialValidation.error ?? 'DNS resolution failed'}`
    )
  }

  const { fetch: pinnedFetch, dispatcher } = createPinnedFetchWithDispatcher(
    initialValidation.resolvedIP,
    { maxResponseSize: 64 * 1024 }
  )
  let initial: Response | null = null
  let initialStatus: number | null = null
  let location: string | null = null
  try {
    for (let attempt = 1; attempt <= BITBUCKET_READ_MAX_ATTEMPTS; attempt++) {
      try {
        initial = await pinnedFetch(initialUrl, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: options.signal,
        })
      } catch (error) {
        if (
          options.signal?.aborted ||
          attempt === BITBUCKET_READ_MAX_ATTEMPTS ||
          !retryableTransportError(error)
        ) {
          throw error
        }
        await waitForRetry(retryDelayMs(attempt, null)!, options.signal)
        continue
      }
      if (!retryableStatus(initial.status) || attempt === BITBUCKET_READ_MAX_ATTEMPTS) break
      const delayMs = retryDelayMs(attempt, initial.headers.get('retry-after'))
      if (delayMs === null) break
      await initial.body?.cancel()
      await waitForRetry(delayMs, options.signal)
    }
    if (initial) {
      initialStatus = initial.status
      location = initial.headers.get('location')
    }
  } finally {
    await initial?.body?.cancel().catch(() => undefined)
    await dispatcher.close()
  }

  if (initialStatus === null) throw new Error(`Bitbucket ${kind} redirect request failed`)

  if (initialStatus !== 302) {
    throw new Error(`Bitbucket ${kind} endpoint did not return its documented redirect`)
  }
  if (!location) throw new Error(`Bitbucket ${kind} redirect omitted the Location header`)

  const target = new URL(
    validateBitbucketPullRequestRedirect(
      new URL(location, initialUrl).toString(),
      workspaceSlug,
      repoSlug,
      kind
    )
  )
  for (const [key, value] of Object.entries(options.targetQuery ?? {})) {
    target.searchParams.set(key, value)
  }
  return target.toString()
}

/**
 * Performs the documented PR-to-repository redirect without allowing the
 * bearer-authenticated request to follow an unvalidated Location.
 */
export async function secureBitbucketPullRequestRedirect(
  initialUrl: string,
  workspaceSlug: string,
  repoSlug: string,
  kind: BitbucketPullRequestRedirectKind,
  headers: Record<string, string>,
  maxResponseBytes: number,
  options: {
    signal?: AbortSignal
    targetQuery?: Record<string, string>
  } = {}
): Promise<Response> {
  const target = await resolveBitbucketPullRequestRedirect(
    initialUrl,
    workspaceSlug,
    repoSlug,
    kind,
    headers,
    options
  )
  return secureBitbucketRead(target, headers, maxResponseBytes, {
    maxRedirects: 0,
    signal: options.signal,
  })
}
