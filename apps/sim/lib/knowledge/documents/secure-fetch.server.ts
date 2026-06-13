import {
  type SecureFetchOptions,
  type SecureFetchResponse,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import {
  type HTTPError,
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

    if (!response.ok && isRetryableError({ status: response.status })) {
      const errorText = await response.text()
      const error: HTTPError = new Error(
        `HTTP ${response.status}: ${response.statusText} - ${errorText}`
      )
      error.status = response.status
      error.statusText = response.statusText

      const retryAfter = response.headers.get('retry-after')
      if (retryAfter) {
        const waitMs = Number.isNaN(Number(retryAfter))
          ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
          : Number(retryAfter) * 1000
        if (waitMs > 0) {
          error.retryAfterMs = waitMs
        }
      }

      throw error
    }

    return response
  }, retry)
}
