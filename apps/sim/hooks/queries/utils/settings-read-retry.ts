import { isApiClientError } from '@/lib/api/client/errors'

/** Leaves service-unavailable recovery to explicit retries and remounts. */
export function shouldRetrySettingsRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false
  if (!isApiClientError(error)) return true
  if (error.status === 503) return false
  return error.status === 408 || error.status === 429 || error.status >= 500
}
