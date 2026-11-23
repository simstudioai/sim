import type { SearchFailureReason } from '@/lib/knowledge/search/diagnostics'

/**
 * A provider-side read failure whose message tells the caller what to do next, and whether the
 * same read may succeed if retried. Messages are written by Search code, never copied from a
 * provider response body.
 */
export class LiveReadError extends Error {
  readonly diagnosticCode: SearchFailureReason

  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'LiveReadError'
    this.diagnosticCode = retryable ? 'provider_retryable' : 'provider_error'
  }
}
