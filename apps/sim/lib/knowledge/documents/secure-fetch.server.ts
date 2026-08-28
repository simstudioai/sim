import {
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
  allowHttp?: boolean
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
  options: SecureFetchOptions = {},
  retryOptions: SecureFetchRetryOptions = {}
): Promise<SecureFetchResponse> {
  const { allowHttp, timeout, maxResponseBytes, ...retry } = retryOptions
  return retryWithExponentialBackoff(async () => {
    const response = await secureFetchWithValidation(
      url,
      {
        ...options,
        ...(allowHttp !== undefined ? { allowHttp } : {}),
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
