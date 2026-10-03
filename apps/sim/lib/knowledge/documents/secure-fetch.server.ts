import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import {
  createSsrfGuardedFetchWithDispatcher,
  type SecureFetchOptions,
  type SecureFetchResponse,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import {
  createRetryableHttpError,
  isRetryableError,
  type RetryOptions,
  retryWithExponentialBackoff,
} from '@/lib/knowledge/documents/utils'

export interface SecureFetchRetryOptions extends RetryOptions {
  timeout?: number
  maxResponseBytes?: number
}

/**
 * SSRF-safe counterpart to {@link fetchWithRetry} for connector requests to
 * user-controlled hosts. Every attempt re-runs {@link secureFetchWithValidation}
 * (DNS resolution, private/loopback/reserved-IP rejection, IP-pinned connection,
 * redirect re-validation); retry/backoff semantics mirror {@link fetchWithRetry}.
 *
 * Lives in a `.server.ts` module because it pulls in Node-only `dns/promises`
 * via {@link secureFetchWithValidation}; importing it from the shared
 * `documents/utils` barrel would drag that into client bundles.
 */
export async function secureFetchWithRetry(
  url: string,
  options: SecureFetchOptions,
  retryOptions: SecureFetchRetryOptions = {}
): Promise<SecureFetchResponse> {
  const { timeout, maxResponseBytes, ...retry } = retryOptions
  return retryWithExponentialBackoff(async () => {
    const response = await secureFetchWithValidation(
      url,
      {
        ...options,
        ...(timeout !== undefined ? { timeout } : {}),
        ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
      },
      'url'
    )

    /**
     * Headers are passed to `isRetryableError` so a rate-limit 403 is
     * distinguishable from an authorization denial, and are carried onto the
     * thrown error because `retryWithExponentialBackoff` re-evaluates the retry
     * condition against it. `resolveRetryDelayMs` prefers `Retry-After` and
     * falls back to the epoch-seconds reset header that X (and GitHub's primary
     * limit) use instead.
     */
    if (!response.ok && isRetryableError({ status: response.status, headers: response.headers })) {
      throw await createRetryableHttpError(response)
    }

    return response
  }, retry)
}

const DEFAULT_FETCH_RETRY_BUDGET_MS = 150_000
let connectorTransport: ReturnType<typeof createSsrfGuardedFetchWithDispatcher> | undefined

/**
 * Bounds requests and response bodies within one retry budget.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const callerSignal = options.signal
    ? retryOptions.signal
      ? AbortSignal.any([options.signal, retryOptions.signal])
      : options.signal
    : retryOptions.signal

  return retryWithExponentialBackoff(
    async (signal, deadlineAt) => {
      /** The fetch deadline stays active while callers consume the returned response body. */
      const requestSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.max(0, Math.ceil(deadlineAt - Date.now()))),
      ])
      const transport: typeof fetch = async (input, init) => {
        const route = await resolveCurrentOutboundRoute()
        if (route.kind === 'direct') return fetch(input, init)
        connectorTransport ??= createSsrfGuardedFetchWithDispatcher({
          profile: 'configuredEndpoint',
        })
        return connectorTransport.fetch(input, init)
      }
      const init = { ...options, signal: requestSignal }
      const response = retryOptions.fetcher
        ? await retryOptions.fetcher(url, init, transport)
        : await transport(url, init)

      if (
        !response.ok &&
        isRetryableError({ status: response.status, headers: response.headers })
      ) {
        throw await createRetryableHttpError(response)
      }

      return response
    },
    {
      ...retryOptions,
      retryBudgetMs: retryOptions.retryBudgetMs ?? DEFAULT_FETCH_RETRY_BUDGET_MS,
      maxRetryAfterMs:
        retryOptions.maxRetryAfterMs ??
        retryOptions.retryBudgetMs ??
        retryOptions.maxDelayMs ??
        30_000,
      signal: callerSignal,
    }
  )
}
